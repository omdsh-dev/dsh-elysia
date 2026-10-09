import type { ApiPipeline } from '@genapi/shared'
import { basename, dirname, resolve } from 'node:path'
import ts from 'typescript'

const methods = new Set(['get', 'head', 'post', 'put', 'patch', 'delete', 'options'])
const splitter = /[-_/.]/
const digit = /\d/
const diagnosticHost: ts.FormatDiagnosticsHost = {
  getCurrentDirectory: ts.sys.getCurrentDirectory,
  getCanonicalFileName: name => name,
  getNewLine: () => '\n',
}

/** Splits a name on separators and acronym boundaries, the way GenAPI's pascal-case does. */
function words(value: string): string[] {
  const parts: string[] = []
  let part = ''
  let upper: boolean | undefined
  let previous = true
  for (const char of value) {
    if (splitter.test(char)) {
      parts.push(part)
      part = ''
      upper = undefined
      previous = true
      continue
    }
    const isUpper = digit.test(char) ? undefined : char !== char.toLowerCase()
    const startsWord = !previous && upper === false && isUpper === true
    const endsAcronym = !previous && upper === true && isUpper === false && part.length > 1
    if (startsWord || endsAcronym) {
      parts.push(startsWord ? part : part.slice(0, -1))
      part = startsWord ? '' : part[part.length - 1]
    }
    part += char
    upper = isUpper
    previous = false
  }
  parts.push(part)
  return parts
}

function pascal(value: string): string {
  return words(value).map(part => part.replace(/^./, char => char.toUpperCase())).join('')
}

/**
 * Definition names are referenced through `$ref`, and GenAPI re-derives the referenced type with
 * `varName` from `@genapi/parser`: pascal-case, drop non-alphanumerics, pascal-case again. Names
 * are built through that same normalisation so the declared type and the referenced one agree.
 */
function typeName(...parts: string[]): string {
  return pascal(pascal(parts.filter(Boolean).join('/')).replace(/[^\dA-Z]+/gi, ''))
}

export function original(configRead: ApiPipeline.ConfigRead): ApiPipeline.ConfigRead {
  if (!configRead.inputs.uri)
    throw new TypeError('dsh-elysia/genapi: input must be a local service entry file')
  const entry = resolve(configRead.inputs.uri)
  const configFile = ts.findConfigFile(dirname(entry), ts.sys.fileExists)
  let options: ts.CompilerOptions = { strict: true, target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.Preserve, moduleResolution: ts.ModuleResolutionKind.Bundler, skipLibCheck: true }
  if (configFile) {
    const loaded = ts.readConfigFile(configFile, ts.sys.readFile)
    if (loaded.error)
      throw new Error(ts.flattenDiagnosticMessageText(loaded.error.messageText, '\n'))
    const parsed = ts.parseJsonConfigFileContent(loaded.config, ts.sys, dirname(configFile))
    if (parsed.errors.length)
      throw new Error(ts.formatDiagnostics(parsed.errors, diagnosticHost))
    options = parsed.options
  }
  const program = ts.createProgram([entry], options)
  const file = program.getSourceFile(entry)
  if (!file)
    throw new Error(`dsh-elysia/genapi: cannot read service entry ${entry}`)
  const diagnostics = ts.getPreEmitDiagnostics(program)
  if (diagnostics.length)
    throw new Error(ts.formatDiagnostics(diagnostics, diagnosticHost))
  const checker = program.getTypeChecker()
  const typeScope = configRead.graphs.scopes.type
  if (!typeScope)
    throw new TypeError('dsh-elysia/genapi: a TypeScript type output is required')
  const paths: Record<string, Record<string, unknown>> = {}
  const declared = new Set<string>()

  function fail(node: ts.Node, message: string): never {
    const source = node.getSourceFile()
    const { line, character } = source.getLineAndCharacterOfPosition(node.getStart())
    throw new TypeError(`dsh-elysia/genapi: ${source.fileName}:${line + 1}:${character + 1}: ${message}`)
  }

  function symbolOf(node: ts.Node): ts.Symbol | undefined {
    const symbol = checker.getSymbolAtLocation(node)
    return symbol && symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol
  }

  function nameOf(node: ts.Expression): string | undefined {
    return symbolOf(ts.isPropertyAccessExpression(node) ? node.name : node)?.getName()
  }

  function valueOf(node: ts.Expression, seen = new Set<ts.Symbol>()): ts.Expression | ts.FunctionDeclaration {
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isTypeAssertionExpression(node) || ts.isSatisfiesExpression(node) || ts.isNonNullExpression(node))
      return valueOf(node.expression, seen)
    if (!ts.isIdentifier(node) && !ts.isPropertyAccessExpression(node))
      return node
    const symbol = symbolOf(ts.isPropertyAccessExpression(node) ? node.name : node)
    if (!symbol || seen.has(symbol))
      return node
    seen.add(symbol)
    const declaration = symbol.valueDeclaration
    if (!declaration)
      return node
    if (ts.isVariableDeclaration(declaration) && declaration.initializer) {
      if (!(declaration.parent.flags & ts.NodeFlags.Const))
        return fail(node, 'route bindings must be const')
      return valueOf(declaration.initializer, seen)
    }
    if (ts.isExportAssignment(declaration))
      return valueOf(declaration.expression, seen)
    return ts.isFunctionDeclaration(declaration) ? declaration : node
  }

  function textOf(node: ts.Expression): string {
    const value = valueOf(node)
    if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value))
      return value.text
    return fail(node, 'route paths and HTTP methods must be static strings')
  }

  function typeValue(type: ts.Type, node: ts.Node, seen = new Set<ts.Type>()): string {
    if (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown))
      return 'unknown'
    if (type.flags & (ts.TypeFlags.StringLiteral | ts.TypeFlags.NumberLiteral))
      return JSON.stringify((type as ts.StringLiteralType | ts.NumberLiteralType).value)
    if (type.isUnionOrIntersection())
      return `(${type.types.map(part => typeValue(part, node, seen)).join(type.isUnion() ? ' | ' : ' & ')})`
    if (type.flags & (ts.TypeFlags.TypeParameter | ts.TypeFlags.BigIntLike | ts.TypeFlags.ESSymbolLike))
      return fail(node, 'request and response contracts must be concrete JSON types')
    if (!(type.flags & ts.TypeFlags.Object))
      return checker.typeToString(type)
    if (type.getSymbol()?.getName() === 'Date')
      return 'string'
    if (seen.has(type))
      return fail(node, 'recursive contracts are not supported')
    const nested = new Set(seen).add(type)
    if (checker.isArrayType(type))
      return `(${typeValue(checker.getTypeArguments(type as ts.TypeReference)[0], node, nested)})[]`
    if (checker.isTupleType(type))
      return tupleValue(type as ts.TupleTypeReference, node, nested)
    if (type.getCallSignatures().length || type.getConstructSignatures().length)
      return fail(node, 'functions and class instances are not JSON contracts')
    const fields = checker.getPropertiesOfType(type).map((property) => {
      const value = typeValue(checker.getTypeOfSymbolAtLocation(property, node), node, nested)
      return `${JSON.stringify(property.getName())}${property.flags & ts.SymbolFlags.Optional ? '?' : ''}: ${value}`
    })
    for (const [kind, name] of [[ts.IndexKind.String, 'string'], [ts.IndexKind.Number, 'number']] as const) {
      const index = checker.getIndexTypeOfType(type, kind)
      if (index)
        fields.push(`[key: ${name}]: ${typeValue(index, node, nested)}`)
    }
    return `{ ${fields.join('; ')} }`
  }

  function tupleValue(tuple: ts.TupleTypeReference, node: ts.Node, seen: Set<ts.Type>): string {
    return `[${checker.getTypeArguments(tuple).map((part, index) => {
      const value = typeValue(part, node, seen)
      const flag = tuple.target.elementFlags[index]
      return flag & ts.ElementFlags.Rest ? `...(${value})[]` : flag & ts.ElementFlags.Optional ? `(${value})?` : value
    }).join(', ')}]`
  }

  function declare(node: ts.Node, name: string): string {
    if (declared.has(name))
      return fail(node, `generated type name ${name} is already used; make the route paths distinguishable`)
    declared.add(name)
    return name
  }

  function alias(name: string, type: ts.Type, node: ts.Node): { $ref: string } {
    typeScope.typings.push({ name: declare(node, name), value: typeValue(type, node), export: true })
    return { $ref: `#/definitions/${name}` }
  }

  function handlerOf(node: ts.Expression): ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration | ts.ObjectLiteralExpression {
    const value = valueOf(node)
    if (ts.isObjectLiteralExpression(value))
      return value
    if ((ts.isArrowFunction(value) || ts.isFunctionExpression(value) || ts.isFunctionDeclaration(value)) && value.body && value.parameters.length < 2)
      return value
    return fail(node, 'use a statically resolvable Elysia handler or JSON object, not a Node callback or sub-application')
  }

  function routeOf(route: ts.Expression): { path: string, parameters: Array<Record<string, unknown>> } {
    let path = textOf(route)
    if (!path.startsWith('/') || path.startsWith('//') || /[?#\\'`$]/.test(path))
      return fail(route, 'route path must be an absolute pathname without query, fragment or code delimiters')
    if (/[{}]/.test(path))
      return fail(route, 'only static paths and simple :parameter segments below a static prefix are supported')
    path = new URL(path, 'http://localhost').pathname
    // ponytail: terminal /* exposes only its reachable trailing-slash endpoint; model descendant paths when needed.
    if (path.endsWith('/*') && path !== '/*' && !path.endsWith('//*') && !path.includes(':'))
      path = path.slice(0, -1)
    else if (path !== '/' && !path.includes(':'))
      path = path.replace(/\/$/, '')
    const parameters: Array<Record<string, unknown>> = []
    if (/^\/:|[*()+]/.test(path))
      return fail(route, 'only static paths and simple :parameter segments below a static prefix are supported')
    path = path.replace(/\/:([A-Z_$][\w$]*)(?=\/|$)/gi, (_, name: string) => {
      if (parameters.some(parameter => parameter.name === name))
        return fail(route, 'path parameter names must be unique')
      parameters.push({ name, in: 'path', required: true, type: 'string' })
      return `/{${name}}`
    })
    if (path.includes(':'))
      return fail(route, 'only simple :parameter segments are supported')
    return { path, parameters }
  }

  function schemaType(routeOptions: ts.ObjectLiteralExpression | undefined, kind: string): ts.Type | undefined {
    if (!routeOptions)
      return
    const field = checker.getPropertyOfType(checker.getTypeAtLocation(routeOptions), kind)
    if (!field)
      return
    const schema = checker.getTypeOfSymbolAtLocation(field, routeOptions)
    function rejectTransforms(type: ts.Type, seen = new Set<ts.Type>()): void {
      if (seen.has(type))
        return
      const nested = new Set(seen).add(type)
      for (const property of checker.getPropertiesOfType(type)) {
        if (property.getName().startsWith('__@TransformKind@'))
          fail(routeOptions!, 'transform schemas require separate wire contracts and are not supported')
      }
      if (type.flags & ts.TypeFlags.Object) {
        for (const argument of checker.getTypeArguments(type as ts.TypeReference))
          rejectTransforms(argument, nested)
      }
      if (type.isUnionOrIntersection())
        type.types.forEach(part => rejectTransforms(part, nested))
      if (!checker.getPropertyOfType(type, 'static') && !checker.isArrayType(type) && !checker.isTupleType(type))
        checker.getPropertiesOfType(type).forEach(property => rejectTransforms(checker.getTypeOfSymbolAtLocation(property, routeOptions!), nested))
    }
    rejectTransforms(schema)
    const staticType = checker.getPropertyOfType(schema, 'static')
    if (!staticType)
      return fail(routeOptions, 'route schemas must be concrete Elysia JSON schemas, not model names or response status maps')
    const type = checker.getTypeOfSymbolAtLocation(staticType, routeOptions)
    function validate(type: ts.Type, seen = new Set<ts.Type>()): void {
      if (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown))
        fail(routeOptions!, 'route schemas must be concrete JSON types; unsupported schemas cannot generate unknown')
      if (seen.has(type) || type.getSymbol()?.getName() === 'Date')
        return
      const nested = new Set(seen).add(type)
      if (type.isUnionOrIntersection()) {
        type.types.forEach(part => validate(part, nested))
      }
      else if (checker.isArrayType(type) || checker.isTupleType(type)) {
        checker.getTypeArguments(type as ts.TypeReference).forEach(part => validate(part, nested))
      }
      else if (type.flags & ts.TypeFlags.Object) {
        checker.getPropertiesOfType(type).forEach(property => validate(checker.getTypeOfSymbolAtLocation(property, routeOptions!), nested))
        for (const kind of [ts.IndexKind.String, ts.IndexKind.Number]) {
          const index = checker.getIndexTypeOfType(type, kind)
          if (index)
            validate(index, nested)
        }
      }
    }
    validate(type)
    typeValue(type, routeOptions)
    return type
  }

  function contextReads(fn: ReturnType<typeof handlerOf>): Set<string> {
    const context = !ts.isObjectLiteralExpression(fn) && fn.parameters[0]
    const used = new Set<string>()
    if (context) {
      if (ts.isObjectBindingPattern(context.name)) {
        for (const element of context.name.elements)
          used.add((element.propertyName ?? element.name).getText())
      }
      else if (ts.isIdentifier(context.name)) {
        const symbol = checker.getSymbolAtLocation(context.name)
        const visit = (node: ts.Node): void => {
          if (ts.isPropertyAccessExpression(node) && checker.getSymbolAtLocation(node.expression) === symbol)
            used.add(node.name.text)
          if (ts.isElementAccessExpression(node) && checker.getSymbolAtLocation(node.expression) === symbol && node.argumentExpression && ts.isStringLiteral(node.argumentExpression))
            used.add(node.argumentExpression.text)
          if (ts.isVariableDeclaration(node) && ts.isObjectBindingPattern(node.name) && node.initializer && checker.getSymbolAtLocation(node.initializer) === symbol) {
            for (const element of node.name.elements)
              used.add((element.propertyName ?? element.name).getText())
          }
          ts.forEachChild(node, visit)
        }
        visit(fn)
      }
    }
    return used
  }

  function isNamedObject(type: ts.Type): boolean {
    return !!(type.flags & ts.TypeFlags.Object) && !checker.isArrayType(type) && !checker.isTupleType(type) && !checker.getIndexTypeOfType(type, ts.IndexKind.String) && !checker.getIndexTypeOfType(type, ts.IndexKind.Number)
  }

  function emitRequest(name: string, kind: string, type: ts.Type, handler: ts.Expression, parameters: Array<Record<string, unknown>>): void {
    if (kind === 'query') {
      for (const field of checker.getPropertiesOfType(type)) {
        const ref = alias(typeName(name, 'query', field.getName()), checker.getTypeOfSymbolAtLocation(field, handler), handler)
        parameters.push({ ...ref, name: field.getName(), in: 'query', required: !(field.flags & ts.SymbolFlags.Optional) })
      }
      return
    }
    const properties = checker.getPropertiesOfType(type).map(field => ({ name: field.getName(), type: typeValue(checker.getTypeOfSymbolAtLocation(field, handler), handler), required: !(field.flags & ts.SymbolFlags.Optional) }))
    const body = declare(handler, typeName(name, 'body'))
    typeScope.interfaces.push({ name: body, properties, export: true })
    parameters.push({ name: 'body', in: 'body', required: true, schema: { $ref: `#/definitions/${body}` } })
  }

  function requestContracts(name: string, handler: ts.Expression, fn: ReturnType<typeof handlerOf>, routeOptions: ts.ObjectLiteralExpression | undefined, parameters: Array<Record<string, unknown>>): void {
    const context = !ts.isObjectLiteralExpression(fn) && fn.parameters[0]
    const contextType = context && checker.getTypeAtLocation(context)
    const used = contextReads(fn)
    for (const kind of ['query', 'body']) {
      let type = schemaType(routeOptions, kind)
      if (!type && contextType && used.has(kind)) {
        const property = checker.getPropertyOfType(contextType, kind)
        type = property && checker.getTypeOfSymbolAtLocation(property, context!)
      }
      if (!type) {
        if (used.has(kind))
          fail(context || handler, 'query/body requires an explicit typed context or route schema')
        continue
      }
      type = checker.getNonNullableType(type)
      if (!isNamedObject(type))
        return fail(context || handler, `${kind} requires an object contract with named fields`)
      emitRequest(name, kind, type, handler, parameters)
    }
  }

  function register(call: ts.CallExpression, method: string, route: ts.Expression, handler: ts.Expression, options?: ts.Expression): void {
    if (!methods.has(method))
      return fail(call, 'declare a specific OpenAPI HTTP method instead of all/connect/trace/query')
    const { path, parameters } = routeOf(route)
    paths[path] ??= {}
    if (paths[path][method])
      return fail(call, `duplicate ${method.toUpperCase()} ${path}`)
    const name = typeName(method, path)
    const fn = handlerOf(handler)
    const signature = checker.getTypeAtLocation(handler).getCallSignatures()[0]
    if (!ts.isObjectLiteralExpression(fn) && !signature)
      return fail(handler, 'handler must be callable')
    const response = signature ? checker.getReturnTypeOfSignature(signature) : checker.getTypeAtLocation(handler)
    const value = options && valueOf(options)
    if (value && !ts.isObjectLiteralExpression(value))
      return fail(options!, 'route options must be a static object')
    const routeOptions = value as ts.ObjectLiteralExpression | undefined
    if (routeOptions && checker.getPropertyOfType(checker.getTypeAtLocation(routeOptions), 'parse'))
      return fail(routeOptions, 'explicit parsers are not supported by the JSON client contract')
    if (routeOptions && ['beforeHandle', 'afterHandle', 'mapResponse', 'error', 'onError', 'transform', 'resolve', 'derive', 'onRequest', 'afterResponse'].some(name => checker.getPropertyOfType(checker.getTypeAtLocation(routeOptions), name)))
      return fail(routeOptions, 'route-local lifecycle hooks are not supported by the JSON client contract')
    const responseType = checker.getAwaitedType(response) ?? response
    const responseParts = responseType.isUnion() ? responseType.types : [responseType]
    if (responseParts.some(part => !!(part.flags & ts.TypeFlags.StringLike)))
      return fail(handler, 'plain string responses are not supported by the JSON client contract')
    typeValue(responseType, handler)
    const schema = alias(typeName(name, 'response'), schemaType(routeOptions, 'response') ?? responseType, handler)
    requestContracts(name, handler, fn, routeOptions, parameters)
    paths[path][method] = { parameters, responses: { 200: { description: `${method.toUpperCase()} ${path}`, schema } } }
  }

  // ponytail: only static, direct registrations; add explicit AST cases when dynamic setups are needed.
  function collect(node: ts.CallExpression): void {
    const setup = valueOf(node.arguments[0])
    if (!(ts.isArrowFunction(setup) || ts.isFunctionExpression(setup) || ts.isFunctionDeclaration(setup)) || !setup.body || !setup.parameters[0] || !ts.isIdentifier(setup.parameters[0].name))
      return fail(node, 'defineWebServer requires a static setup callback with an app parameter')
    const app = checker.getSymbolAtLocation(setup.parameters[0].name)
    function isApp(expression: ts.Expression): boolean {
      return ts.isIdentifier(expression) ? checker.getSymbolAtLocation(expression) === app : ts.isCallExpression(expression) && ts.isPropertyAccessExpression(expression.expression) && isApp(expression.expression.expression)
    }
    function visit(expression: ts.Expression): void {
      if (!ts.isCallExpression(expression) || !ts.isPropertyAccessExpression(expression.expression) || !isApp(expression.expression.expression))
        return fail(expression, 'setup must use direct app.method(...) route declarations')
      const receiver = expression.expression.expression
      if (ts.isCallExpression(receiver))
        visit(receiver)
      const method = expression.expression.name.text
      if (method === 'use')
        return fail(expression, 'plugins and mounted route registration are not supported; declare routes directly without executing plugins')
      if (method === 'onRequest') {
        const hook = expression.arguments[0] && checker.getTypeAtLocation(expression.arguments[0]).getCallSignatures()[0]
        const result = hook && checker.getReturnTypeOfSignature(hook)
        const awaited = result && (checker.getAwaitedType(result) ?? result)
        if (!awaited || !(awaited.flags & (ts.TypeFlags.Void | ts.TypeFlags.Undefined | ts.TypeFlags.Never)))
          return fail(expression, 'onRequest hooks that can return a response are not supported')
        return
      }
      if (method === 'route') {
        if (expression.arguments.length < 3)
          return fail(expression, 'app.route requires method, path and handler')
        register(expression, textOf(expression.arguments[0]).toLowerCase(), expression.arguments[1], expression.arguments[2], expression.arguments[3])
      }
      else {
        if (expression.arguments.length < 2)
          return fail(expression, 'route declarations require path and handler')
        register(expression, method, expression.arguments[0], expression.arguments[1], expression.arguments[2])
      }
    }
    function statementOf(statement: ts.Statement): void {
      if (ts.isExpressionStatement(statement))
        return visit(statement.expression)
      if (ts.isReturnStatement(statement)) {
        if (statement.expression && checker.getSymbolAtLocation(statement.expression) !== app)
          visit(statement.expression)
        return
      }
      if (ts.isEmptyStatement(statement))
        return
      if (!ts.isVariableStatement(statement))
        return fail(statement, 'conditional, looped and mounted route registration is not supported')
      if (!(statement.declarationList.flags & ts.NodeFlags.Const))
        return fail(statement, 'route bindings must be const')
      const check = (node: ts.Node): void => {
        if (ts.isIdentifier(node) && checker.getSymbolAtLocation(node) === app)
          fail(node, 'setup must use direct app.method(...) route declarations')
        ts.forEachChild(node, check)
      }
      check(statement)
    }
    if (ts.isBlock(setup.body)) {
      for (const statement of setup.body.statements) {
        statementOf(statement)
        if (ts.isReturnStatement(statement))
          break
      }
    }
    else {
      visit(setup.body)
    }
  }

  function scan(node: ts.Node): void {
    if (ts.isFunctionLike(node))
      return
    if (ts.isCallExpression(node) && nameOf(node.expression) === 'defineWebServer') {
      let parent = node.parent
      while (ts.isParenthesizedExpression(parent) || ts.isAsExpression(parent) || ts.isSatisfiesExpression(parent))
        parent = parent.parent
      const statement = ts.isVariableDeclaration(parent) ? parent.parent.parent : parent
      if (!ts.isSourceFile(statement.parent) || (!ts.isVariableStatement(statement) && !ts.isExportAssignment(statement)))
        return fail(node, 'services must be declared directly at module scope, not in a conditional or factory')
      collect(node)
    }
    else {
      ts.forEachChild(node, scan)
    }
  }
  scan(file)
  if (!Object.keys(paths).length)
    throw new TypeError('dsh-elysia/genapi: no static defineWebServer routes found in input')
  configRead.source = { swagger: '2.0', info: { title: basename(entry, '.ts'), version: '0.0.0' }, paths, definitions: {} }
  return configRead
}

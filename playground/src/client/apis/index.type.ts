export type GetApiHealthResponse = { status: string; uptimeMs: number };
export type GetApiServerResponse = { port: number };
export type GetApiInspectResponse = { method: string; path: string; query: { query?: undefined | string } };
export type GetApiInspectQueryQuery = undefined | string;
export type GetApiEchochannelResponse = { channel: string; method: string; pretty: false | true; limit: number; query: { pretty?: undefined | false | true; limit?: undefined | number } };
export type GetApiEchochannelQueryPretty = undefined | false | true;
export type GetApiEchochannelQueryLimit = undefined | number;
export type PostApiEchochannelResponse = { channel: string; method: string; pretty: false | true; limit: number; query: { pretty?: undefined | false | true; limit?: undefined | number } } & { body: { tags?: undefined | string[]; metadata?: undefined | { [key: string]: string }; message: string } };
export type PostApiEchochannelQueryPretty = undefined | false | true;
export type PostApiEchochannelQueryLimit = undefined | number;

export interface PostApiEchochannelBody {
  tags?: undefined | string[];
  metadata?: undefined | { [key: string]: string };
  message: string;
}
export interface GetApiInspectQuery {
  query?: GetApiInspectQueryQuery;
}
export interface GetApiEchochannelPath {
  channel: string;
}
export interface GetApiEchochannelQuery {
  pretty?: GetApiEchochannelQueryPretty;
  limit?: GetApiEchochannelQueryLimit;
}
export interface PostApiEchochannelPath {
  channel: string;
}
export interface PostApiEchochannelQuery {
  pretty?: PostApiEchochannelQueryPretty;
  limit?: PostApiEchochannelQueryLimit;
}

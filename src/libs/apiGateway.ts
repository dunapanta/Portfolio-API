type Response = {
  statusCode?: number;
  data?: any;
  headers?: Record<string, string>;
};

export const formatJSONResponse = ({
  statusCode = 200,
  data = {},
  headers,
}: Response) => {
  return {
    statusCode: statusCode,
    body: JSON.stringify(data),
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Magic-Layers-Key,X-Creative-Studio-Key,X-App-Opportunities-Key,X-Remates-Admin-Key",
      "Access-Control-Allow-Methods": "DELETE,GET,POST,PATCH,OPTIONS",
      ...headers,
    },
  };
};

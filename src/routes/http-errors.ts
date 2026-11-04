function httpError(statusCode: number, message: string): Error {
  return Object.assign(new Error(message), { statusCode });
}

export function badRequest(message: string): Error {
  return httpError(400, message);
}

export function notFound(message: string): Error {
  return httpError(404, message);
}

export function conflict(message: string): Error {
  return httpError(409, message);
}

export function unprocessable(message: string): Error {
  return httpError(422, message);
}

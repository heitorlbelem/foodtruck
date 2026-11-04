import { bearer, errors, idField } from "../../shared/schemas.ts";

const tags = ["autenticacao"];

const userExample = {
  id: "4b7c2a8e-0d1f-4c3a-9e6b-2f5d8a1c7e90",
  name: "Dono",
  email: "dono@foodtruck.com",
  role: "owner",
};

export const authUserSchema = {
  $id: "AuthUser",
  type: "object",
  properties: {
    id: idField,
    name: { type: "string" },
    email: { type: "string" },
    role: { type: "string", description: "Papel do usuário. Hoje só `owner`." },
  },
  required: ["id", "name", "email", "role"],
  examples: [userExample],
};

export const tokenPairSchema = {
  $id: "TokenPair",
  type: "object",
  properties: {
    access_token: {
      type: "string",
      description: "JWT enviado em `Authorization: Bearer`. Vale 15 minutos.",
    },
    token_type: { type: "string", enum: ["Bearer"] },
    expires_in: {
      type: "integer",
      description: "Validade do `access_token`, em segundos.",
    },
    refresh_token: {
      type: "string",
      description:
        "Uso único: cada renovação devolve um novo e invalida este. Guarde só o mais recente.",
    },
    refresh_expires_at: {
      type: "string",
      format: "date-time",
      description:
        "Fim da sessão (24 horas após o login). Renovar não estende esse prazo.",
    },
    user: { $ref: "AuthUser#" },
  },
  required: [
    "access_token",
    "token_type",
    "expires_in",
    "refresh_token",
    "refresh_expires_at",
    "user",
  ],
  examples: [
    {
      access_token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.c2lnbmF0dXJl",
      token_type: "Bearer",
      expires_in: 900,
      refresh_token: "q3ZtYk0n8Zr1m5xJp2dHcQ7sWfL9aBuE4oTgNiVyRXk",
      refresh_expires_at: "2026-11-05T12:00:00.000Z",
      user: userExample,
    },
  ],
};

const UNAUTHENTICATED =
  "`UNAUTHENTICATED`: token ausente, inválido ou expirado, ou usuário inexistente ou inativo. Renove com `/auth/refresh` ou faça login de novo.";

export const loginSchema = {
  tags,
  summary: "Entrar",
  description:
    "Troca e-mail e senha por um par de tokens. O e-mail ignora maiúsculas e espaços nas pontas. Depois de 5 falhas para o mesmo e-mail, ou 20 para o mesmo IP, em 15 minutos, responde 429 com `Retry-After`.",
  body: {
    type: "object",
    properties: {
      email: { type: "string", minLength: 1, maxLength: 254 },
      password: { type: "string", minLength: 1, maxLength: 128 },
    },
    required: ["email", "password"],
    additionalProperties: false,
  },
  response: {
    200: { description: "Sessão criada.", $ref: "TokenPair#" },
    ...errors(
      {
        401: "`INVALID_CREDENTIALS`: e-mail ou senha incorretos. A resposta é a mesma para e-mail desconhecido, senha errada e usuário inativo.",
        429: "`TOO_MANY_ATTEMPTS`: muitas tentativas falhas. Aguarde `details.retry_after_seconds` (também no cabeçalho `Retry-After`).",
      },
      { body: true, auth: false },
    ),
  },
};

export const refreshSchema = {
  tags,
  summary: "Renovar a sessão",
  description:
    "Troca um `refresh_token` por um novo par de tokens. Cada `refresh_token` vale uma vez: reapresentar um já usado encerra a sessão inteira. A sessão acaba 24 horas depois do login, mesmo com renovações.",
  body: {
    type: "object",
    properties: {
      refresh_token: { type: "string", minLength: 1, maxLength: 128 },
    },
    required: ["refresh_token"],
    additionalProperties: false,
  },
  response: {
    200: { description: "Novo par de tokens.", $ref: "TokenPair#" },
    ...errors(
      {
        401: "`INVALID_REFRESH_TOKEN`: token desconhecido, já usado, expirado ou de sessão encerrada. Peça login de novo.",
      },
      { body: true, auth: false },
    ),
  },
};

export const logoutSchema = {
  tags,
  security: bearer,
  summary: "Sair",
  description:
    "Encerra a sessão do token usado na chamada; o `refresh_token` dela deixa de funcionar.",
  response: {
    204: { description: "Sessão encerrada.", type: "null" },
    ...errors({ 401: UNAUTHENTICATED }, { input: false }),
  },
};

export const meSchema = {
  tags,
  security: bearer,
  summary: "Usuário autenticado",
  description: "Devolve o usuário dono do token enviado.",
  response: {
    200: { description: "Usuário autenticado.", $ref: "AuthUser#" },
    ...errors({ 401: UNAUTHENTICATED }, { input: false }),
  },
};

/**
 * Règle du projet : l'API renvoie toujours du JSON, erreurs comprises, sous la
 * forme `{ error, message }`. `error` est un code stable destiné au code
 * appelant, `message` une phrase lisible destinée à Nathan.
 */
export class HttpError extends Error {
  constructor(statusCode, error, message) {
    super(message);
    this.statusCode = statusCode;
    this.error = error;
  }
}

export const badRequest = (message) => new HttpError(400, 'bad_request', message);
export const notFound = (message) => new HttpError(404, 'not_found', message);
export const conflict = (message) => new HttpError(409, 'conflict', message);
export const payloadTooLarge = (message) => new HttpError(413, 'payload_too_large', message);

/** Rend lisible la sortie d'AJV : « body/score doit être <= 5 ». */
function formatValidation(err) {
  const parts = (err.validation || []).map((issue) => {
    const where = `${err.validationContext || 'requête'}${issue.instancePath || ''}`;
    return `${where} ${issue.message}`;
  });
  return parts.length ? parts.join(' ; ') : err.message;
}

export function registerErrorHandling(app) {
  app.setErrorHandler((err, request, reply) => {
    if (err.validation) {
      return reply.code(400).send({
        error: 'validation_error',
        message: formatValidation(err),
      });
    }

    if (err instanceof HttpError) {
      return reply.code(err.statusCode).send({ error: err.error, message: err.message });
    }

    // Corps JSON illisible, méthode non supportée, etc. : Fastify a déjà posé un code.
    const status = err.statusCode && err.statusCode >= 400 && err.statusCode < 500 ? err.statusCode : 500;

    if (status >= 500) {
      request.log.error({ err }, 'erreur non gérée');
      return reply.code(500).send({
        error: 'internal_error',
        message: 'Erreur interne du serveur.',
      });
    }

    return reply.code(status).send({
      error: err.code ? String(err.code).toLowerCase() : 'bad_request',
      message: err.message,
    });
  });
}

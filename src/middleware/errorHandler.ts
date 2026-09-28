import type { FastifyError, FastifyRequest, FastifyReply } from 'fastify';
import { AppError } from '../utils/errors.ts';

/**
 * Client đã rời đi (đóng tab, FE abort timeout, Render cold start bị bỏ giữa
 * chừng) — socket đóng nên không còn ai nhận response. `reply.send()` lúc này
 * chỉ sinh thêm lỗi, và log level error sẽ dump stack vô ích.
 * end-of-stream báo 'premature close' mà KHÔNG gắn `code`, nên phải kiểm tra cả
 * message lẫn code — nếu chỉ nhìn code thì mỗi request hụt lại thành 500.
 */
const CLIENT_ABORT_CODES = new Set([
  'ERR_STREAM_PREMATURE_CLOSE',
  'ECONNRESET',
  'EPIPE',
  'ERR_HTTP_REQUEST_TIMEOUT',
]);

function isClientAbort(error: FastifyError): boolean {
  const code = (error as any).code;
  return (typeof code === 'string' && CLIENT_ABORT_CODES.has(code)) || error.message === 'premature close';
}

export function errorHandler(error: FastifyError, request: FastifyRequest, reply: FastifyReply) {
  if (isClientAbort(error)) {
    request.log.warn({ statusCode: 499, code: (error as any).code }, 'Client đã ngắt kết nối trước khi response hoàn tất');
    return;
  }
  const statusCode = (error as any).statusCode || 500;

  // Lỗi 4xx là client sai (body rỗng, validation, 401…) — chỉ warn một dòng, không dump
  // stack; stack thật chỉ có giá trị khi 5xx.
  if (statusCode < 500) {
    request.log.warn({ statusCode, code: (error as any).code }, error.message);
  } else {
    request.log.error(error);
  }

  // Nếu là lỗi nghiệp vụ do chúng ta chủ động quăng ra (AppError)
  if (error instanceof AppError) {
    return reply.status(error.statusCode).send({
      success: false,
      message: error.message,
    });
  }

  // Nếu là lỗi Validation của Fastify (thường sinh ra do Zod schema)
  if (error.validation) {
    return reply.status(400).send({
      success: false,
      message: error.validation.map((v: any) => v.message).filter(Boolean).join('; ') || 'Lỗi xác thực dữ liệu (Validation Failed)',
      errors: error.validation,
    });
  }

  // Các lỗi còn lại — giữ nguyên statusCode từ plugin (vd: 429 rate-limit)
  return reply.status(statusCode).send({
    success: false,
    message: process.env.NODE_ENV === 'development'
      ? error.message
      : (statusCode === 429
        ? 'Vượt quá giới hạn yêu cầu, vui lòng thử lại sau'
        : 'Hệ thống gặp sự cố (Internal Server Error)'),
  });
}

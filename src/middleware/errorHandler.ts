import type { FastifyError, FastifyRequest, FastifyReply } from 'fastify';
import { AppError } from '../utils/errors.ts';

export function errorHandler(error: FastifyError, request: FastifyRequest, reply: FastifyReply) {
  // Suppress spam: ERR_STREAM_PREMATURE_CLOSE là normal khi client ngắt kết nối
  if ((error as any).code === 'ERR_STREAM_PREMATURE_CLOSE') return;
  const statusCode = (error as any).statusCode || 500;

  // In lỗi ra log của Fastify (Pino)
  request.log.error(error);

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
      message: 'Lỗi xác thực dữ liệu (Validation Failed)',
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

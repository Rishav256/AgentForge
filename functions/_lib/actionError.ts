import type { Response } from 'express';

export function actionError(
  res: Response,
  status: number,
  message: string,
  code?: string,
) {
  res.status(status).json({ message, code });
}

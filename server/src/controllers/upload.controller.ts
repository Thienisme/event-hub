import { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { handleControllerError, logUnexpectedError } from '../utils/errors';
import { MAX_IMAGE_BYTES, saveImage } from '../utils/storage';

/**
 * Multer giữ file trong RAM (tối đa 5MB) để kiểm tra magic bytes TRƯỚC khi ghi
 * xuống đĩa. Ghi thẳng bằng diskStorage thì file rác đã nằm trên đĩa trước khi
 * kịp biết nó có phải ảnh hay không.
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_IMAGE_BYTES,
    files: 1,
    fields: 5,
    fieldSize: 1024,
    parts: 10,
  },
});

/**
 * Bọc `upload.single('file')` để tự xử lý lỗi của multer.
 *
 * Mặc định lỗi multer rơi xuống error middleware chung và thành 500 "Lỗi máy chủ",
 * trong khi phần lớn là lỗi của người dùng (file quá lớn, sai tên trường).
 */
export const parseImageUpload = (req: Request, res: Response, next: NextFunction) => {
  upload.single('file')(req, res, (error: unknown) => {
    if (!error) return next();

    if (error instanceof multer.MulterError) {
      if (error.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ message: 'Ảnh không được vượt quá 5MB!' });
      }
      if (error.code === 'LIMIT_UNEXPECTED_FILE' || error.code === 'LIMIT_FILE_COUNT') {
        return res.status(400).json({ message: 'Chỉ gửi một ảnh trong trường "file"!' });
      }
      return res.status(400).json({ message: 'Dữ liệu tải lên không hợp lệ!' });
    }

    // Body multipart hỏng (thiếu boundary, bị cắt giữa chừng...) cũng là lỗi phía client.
    logUnexpectedError('upload', error);
    return res.status(400).json({ message: 'Dữ liệu tải lên không hợp lệ!' });
  });
};

export const uploadImage = async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'Vui lòng chọn một ảnh để tải lên!' });
    }

    const url = await saveImage(req.file.buffer);
    return res.status(201).json({ message: 'Tải ảnh lên thành công!', url });
  } catch (error) {
    return handleControllerError(res, 'uploadImage', error);
  }
};

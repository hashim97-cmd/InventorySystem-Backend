import { Request, Response } from 'express';
import { cloudinary } from '../lib/cloudinary.js';
import { UploadApiErrorResponse } from 'cloudinary';

export const uploadImage = async (req: Request, res: Response) => {
  if (!req.file) {
    return res.status(400).json({ message: 'No file uploaded' });
  }

  try {
    // Upload buffer directly to Cloudinary
    const uploadResult = await new Promise<any>((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: 'inventory/products',
          resource_type: 'image',
          allowed_formats: ['jpg', 'jpeg', 'png', 'webp', 'gif'],
          transformation: [{ quality: 'auto', fetch_format: 'auto' }],
        },
        (error, result) => {
          if (error) reject(error);
          else resolve(result);
        }
      );
      stream.end(req.file!.buffer);
    });

    return res.status(201).json({
      secure_url: uploadResult.secure_url,
      public_id: uploadResult.public_id,
      format: uploadResult.format,
      bytes: uploadResult.bytes,
    });
  } catch (err: any) {
    console.error('Cloudinary upload error:', err);
    return res.status(500).json({ message: 'Image upload failed', error: err.message });
  }
};

export const deleteImage = async (req: Request<{ publicId: string }>, res: Response) => {
  const { publicId } = req.params;

  try {
    const result = await cloudinary.uploader.destroy(publicId);
    if (result.result !== 'ok') {
      return res.status(400).json({ message: 'Failed to delete image', result });
    }
    return res.json({ message: 'Image deleted' });
  } catch (err: any) {
    console.error('Cloudinary delete error:', err);
    return res.status(500).json({ message: 'Image deletion failed', error: err.message });
  }
};
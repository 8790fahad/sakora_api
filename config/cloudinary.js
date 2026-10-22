require("dotenv").config();
const cloudinary = require("cloudinary").v2;

const cloudName = String(process.env.CLOUDINARY_CLOUD_NAME || "").trim();
const apiKey = String(process.env.CLOUDINARY_API_KEY || "").trim();
const apiSecret = String(process.env.CLOUDINARY_API_SECRET || "").trim();

if (!cloudName || !apiKey || !apiSecret) {
  console.warn(
    "[cloudinary] CLOUDINARY_CLOUD_NAME / CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET are not fully set. Uploads will fail until configured in .env."
  );
}

cloudinary.config({
  cloud_name: cloudName,
  api_key: apiKey,
  api_secret: apiSecret,
  secure: true,
});

const uploadBuffer = (buffer) =>
  new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: "sakora/products",
        resource_type: "image",
        format: "jpg",
        transformation: [
          {
            width: 1600,
            height: 1600,
            crop: "limit",
            quality: "auto:good",
          },
        ],
      },
      (error, result) => {
        if (error) return reject(error);
        if (!result?.secure_url) {
          return reject(new Error("Cloudinary did not return an image URL"));
        }
        resolve(result.secure_url);
      }
    );
    stream.end(buffer);
  });

module.exports = { cloudinary, uploadBuffer };

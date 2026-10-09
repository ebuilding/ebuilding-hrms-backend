import { v2 as cloudinary } from "cloudinary";
import { CloudinaryStorage } from "multer-storage-cloudinary";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: "ems-documents",
    allowed_formats: ["jpg", "png", "pdf", "docx", "xlsx"],
    resource_type: "auto", // Important for non-image files like PDF
  },
});

export { cloudinary, storage };

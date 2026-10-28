// Change from require to import
import multer from "multer";

// Rest of your code remains the same
const multerStorage = multer.memoryStorage();
const multerUploads = multer({
  storage: multerStorage
});

export { multerUploads };

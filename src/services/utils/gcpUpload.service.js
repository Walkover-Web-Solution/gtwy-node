import { Storage } from "@google-cloud/storage";
import { v4 as uuidv4 } from "uuid";
import axios from "axios";

const getStorageClient = () => {
  try {
    const credentials = JSON.parse(process.env.GCP_CREDENTIALS);
    return new Storage({ credentials });
  } catch (error) {
    console.error("Error initializing GCP storage client:", error);
    throw new Error("GCP Credentials missing or invalid");
  }
};

const uploadDoc = async (file, folder = "uploads", realTime = false, contentType = null, originalFilename = null) => {
  try {
    const storage = getStorageClient();
    const bucket = storage.bucket("resources.gtwy.ai");

    let filename;
    if (typeof file === "string") {
      filename = `${folder}/${uuidv4()}.png`;
    } else if (originalFilename) {
      const extension = originalFilename.includes(".") ? originalFilename.split(".").pop() : "";
      filename = extension ? `${folder}/${uuidv4()}.${extension}` : `${folder}/${uuidv4()}`;
    } else if (contentType) {
      if (contentType.includes("image")) {
        filename = `${folder}/${uuidv4()}.png`;
      } else if (contentType.includes("pdf")) {
        filename = `${folder}/${uuidv4()}.pdf`;
      } else {
        filename = `${folder}/${uuidv4()}`;
      }
    } else {
      filename = `${folder}/${uuidv4()}`;
    }

    const blob = bucket.file(filename);
    const gcpUrl = `https://resources.gtwy.ai/${filename}`;

    const uploadLogic = async () => {
      if (typeof file === "string") {
        const response = await axios.get(file, { responseType: "arraybuffer" });
        await blob.save(response.data, { contentType: contentType || "application/octet-stream" });
      } else if (Buffer.isBuffer(file)) {
        await blob.save(file, { contentType: contentType || "application/octet-stream" });
      } else {
        if (file.buffer) {
          await blob.save(file.buffer, { contentType: contentType || "application/octet-stream" });
        } else {
          throw new Error("Unsupported file format for upload");
        }
      }
    };

    if (realTime) {
      await uploadLogic();
      return gcpUrl;
    } else {
      uploadLogic().catch((err) => console.error(`Background upload failed for ${filename}:`, err));
      return gcpUrl;
    }
  } catch (error) {
    console.error("GCP upload failed:", error);
    throw error;
  }
};

export default {
  uploadDoc
};

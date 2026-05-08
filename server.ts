import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import multer from "multer";
import mammoth from "mammoth";
import yauzl from "yauzl";
import fs from "fs";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const pdf = require("pdf-parse");

async function startServer() {
  const app = express();
  const PORT = 3000;
  const upload = multer({ dest: "uploads/" });

  app.use(express.json());

  // API to extract text from various file types
  app.post("/api/extract-text", upload.single("file"), async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const filePath = req.file.path;
    const fileType = req.file.originalname.split(".").pop()?.toLowerCase();

    try {
      let extractedText = "";

      if (fileType === "pdf") {
        const dataBuffer = fs.readFileSync(filePath);
        const data = await pdf(dataBuffer);
        extractedText = data.text;
      } else if (fileType === "docx") {
        const result = await mammoth.extractRawText({ path: filePath });
        extractedText = result.value;
      } else if (fileType === "hwpx") {
        // HWPX is a ZIP file. We extract section files from Contents/
        extractedText = await extractHwpxText(filePath);
      } else if (fileType === "txt") {
        extractedText = fs.readFileSync(filePath, "utf-8");
      } else {
        // For old HWP or others, we might just return an error or try raw read
        return res.status(400).json({ error: `Unsupported file type: ${fileType}. Please use PDF or HWPX (modern HWP).` });
      }

      fs.unlinkSync(filePath); // Cleanup
      res.json({ text: extractedText });
    } catch (error: any) {
      console.error("Extraction error:", error);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      res.status(500).json({ error: "Failed to extract text from file" });
    }
  });

  // Helper for HWPX (best effort extraction of section text)
  async function extractHwpxText(zipPath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      let allText = "";
      yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
        if (err) return reject(err);
        zipfile.readEntry();
        zipfile.on("entry", (entry) => {
          // We look for xml files in section folder
          if (/Contents\/section\d+\.xml/.test(entry.fileName)) {
            zipfile.openReadStream(entry, (err, readStream) => {
              if (err) return reject(err);
              let content = "";
              readStream.on("data", (chunk) => content += chunk);
              readStream.on("end", () => {
                // Better XML handling: look for text tags and ensure paragraph separation
                // Standard HWPX text tags are usually <hp:t>, paragraphs are <hp:p>
                const paragraphMatches = content.match(/<hp:p[^>]*>([\s\S]*?)<\/hp:p>/g);
                if (paragraphMatches) {
                  const paraText = paragraphMatches.map(p => {
                    return p.replace(/<hp:t[^>]*>([\s\S]*?)<\/hp:t>/g, "$1")
                            .replace(/<[^>]+>/g, " ")
                            .trim();
                  }).join("\n");
                  allText += paraText + "\n";
                } else {
                  // Fallback for non-standard tags
                  const text = content.replace(/<[^>]+>/g, " ");
                  allText += text + "\n";
                }
                zipfile.readEntry();
              });
            });
          } else {
            zipfile.readEntry();
          }
        });
        zipfile.on("end", () => resolve(allText.trim()));
        zipfile.on("error", (err) => reject(err));
      });
    });
  }

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();

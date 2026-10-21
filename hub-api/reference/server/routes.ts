import type { Express } from "express";
import type { Server } from "http";
import { db } from "./db";
import { agroEntities, fileUploads, insertAgroEntitySchema } from "@shared/schema";
import { eq, like, and, or, desc, asc, sql, gte, lte, ilike } from "drizzle-orm";
import multer from "multer";
import XLSX from "xlsx";
import fs from "fs";

const upload = multer({
  dest: "uploads/",
  limits: { fileSize: 100 * 1024 * 1024 }
});

export async function registerRoutes(httpServer: Server, app: Express) {
  const { registerAuthRoutes } = await import("./routes/auth");
  registerAuthRoutes(app);

  const { registerSicarRoutes } = await import("./routes/sicar");
  registerSicarRoutes(app);

  const { registerAgrofitRoutes } = await import("./routes/agrofit");
  registerAgrofitRoutes(app);

  app.get("/api/health", async (_req, res) => {
    try {
      await db.select({ count: sql<number>`1` }).from(agroEntities).limit(1);
      res.json({
        status: "ok",
        timestamp: new Date().toISOString(),
        version: "1.0.0",
        database: "connected"
      });
    } catch (error: any) {
      res.status(503).json({
        status: "error",
        timestamp: new Date().toISOString(),
        version: "1.0.0",
        database: "disconnected",
        error: error.message
      });
    }
  });

  app.get("/api/entities/search/cpf/:cpfCnpj", async (req, res) => {
    try {
      const cpfCnpj = req.params.cpfCnpj.replace(/\D/g, "");
      if (!cpfCnpj) {
        return res.status(400).json({ error: "CPF/CNPJ e obrigatorio" });
      }
      const entity = await db.select()
        .from(agroEntities)
        .where(eq(agroEntities.cpfCnpj, cpfCnpj))
        .limit(1);

      if (entity.length === 0) {
        return res.status(404).json({ error: "Nenhum cadastro encontrado com este CPF/CNPJ" });
      }
      res.json(entity[0]);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/entities/segments", async (_req, res) => {
    try {
      const segments = await db
        .selectDistinct({ segment: agroEntities.segment })
        .from(agroEntities)
        .where(sql`${agroEntities.segment} IS NOT NULL`);
      res.json(segments.map(s => s.segment).filter(Boolean).sort());
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/entities/cities/:state", async (req, res) => {
    try {
      const stateParam = req.params.state.toUpperCase();
      const cities = await db
        .selectDistinct({ city: agroEntities.city })
        .from(agroEntities)
        .where(and(
          eq(agroEntities.state, stateParam),
          sql`${agroEntities.city} IS NOT NULL`
        ));
      res.json(cities.map(c => c.city).filter(Boolean).sort());
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/entities/types", async (_req, res) => {
    try {
      const types = await db
        .selectDistinct({ entityType: agroEntities.entityType })
        .from(agroEntities)
        .where(sql`${agroEntities.entityType} IS NOT NULL`);
      res.json(types.map(t => t.entityType));
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/entities/states", async (_req, res) => {
    try {
      const states = await db
        .selectDistinct({ state: agroEntities.state })
        .from(agroEntities)
        .where(sql`${agroEntities.state} IS NOT NULL`);
      res.json(states.map(s => s.state).filter(Boolean));
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/entities/categories", async (_req, res) => {
    try {
      const categories = await db
        .selectDistinct({ category: agroEntities.category })
        .from(agroEntities)
        .where(sql`${agroEntities.category} IS NOT NULL`);
      res.json(categories.map(c => c.category).filter(Boolean).sort());
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/entities/sub-categories", async (_req, res) => {
    try {
      const subs = await db
        .selectDistinct({ subCategory: agroEntities.subCategory })
        .from(agroEntities)
        .where(sql`${agroEntities.subCategory} IS NOT NULL`);
      res.json(subs.map(s => s.subCategory).filter(Boolean).sort());
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/entities/product-types", async (_req, res) => {
    try {
      const pts = await db
        .selectDistinct({ productType: agroEntities.productType })
        .from(agroEntities)
        .where(sql`${agroEntities.productType} IS NOT NULL`);
      res.json(pts.map(p => p.productType).filter(Boolean).sort());
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/entities/regions", async (_req, res) => {
    try {
      const regions = await db
        .selectDistinct({ region: agroEntities.region })
        .from(agroEntities)
        .where(sql`${agroEntities.region} IS NOT NULL`);
      res.json(regions.map(r => r.region).filter(Boolean).sort());
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/entities/source-files", async (_req, res) => {
    try {
      const files = await db
        .selectDistinct({ sourceFile: agroEntities.sourceFile })
        .from(agroEntities)
        .where(sql`${agroEntities.sourceFile} IS NOT NULL`);
      res.json(files.map(f => f.sourceFile).filter(Boolean).sort());
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/entities/filter-options", async (_req, res) => {
    try {
      const [types, statesList, categories, subCategories, productTypes, segments, regions, sourceFiles] = await Promise.all([
        db.selectDistinct({ v: agroEntities.entityType }).from(agroEntities).where(sql`${agroEntities.entityType} IS NOT NULL`),
        db.selectDistinct({ v: agroEntities.state }).from(agroEntities).where(sql`${agroEntities.state} IS NOT NULL`),
        db.selectDistinct({ v: agroEntities.category }).from(agroEntities).where(sql`${agroEntities.category} IS NOT NULL`),
        db.selectDistinct({ v: agroEntities.subCategory }).from(agroEntities).where(sql`${agroEntities.subCategory} IS NOT NULL`),
        db.selectDistinct({ v: agroEntities.productType }).from(agroEntities).where(sql`${agroEntities.productType} IS NOT NULL`),
        db.selectDistinct({ v: agroEntities.segment }).from(agroEntities).where(sql`${agroEntities.segment} IS NOT NULL`),
        db.selectDistinct({ v: agroEntities.region }).from(agroEntities).where(sql`${agroEntities.region} IS NOT NULL`),
        db.selectDistinct({ v: agroEntities.sourceFile }).from(agroEntities).where(sql`${agroEntities.sourceFile} IS NOT NULL`),
      ]);
      res.json({
        types: types.map(t => t.v).filter(Boolean).sort(),
        states: statesList.map(s => s.v).filter(Boolean).sort(),
        categories: categories.map(c => c.v).filter(Boolean).sort(),
        subCategories: subCategories.map(s => s.v).filter(Boolean).sort(),
        productTypes: productTypes.map(p => p.v).filter(Boolean).sort(),
        segments: segments.map(s => s.v).filter(Boolean).sort(),
        regions: regions.map(r => r.v).filter(Boolean).sort(),
        sourceFiles: sourceFiles.map(f => f.v).filter(Boolean).sort(),
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/entities", async (req, res) => {
    try {
      const {
        entityType,
        state,
        city,
        category,
        subCategory,
        productType,
        segment,
        segment2,
        region,
        neighborhood,
        cep,
        email,
        cpfCnpj,
        sourceFile,
        deliveryState,
        deliveryCity,
        search,
        createdFrom,
        createdTo,
        importedFrom,
        importedTo,
        sort = "createdAt",
        order = "desc",
        limit = "100",
        offset = "0"
      } = req.query;

      const filters = [];

      if (entityType) filters.push(eq(agroEntities.entityType, entityType as string));
      if (state) filters.push(eq(agroEntities.state, (state as string).toUpperCase()));
      if (city) filters.push(ilike(agroEntities.city, `%${city}%`));
      if (category) filters.push(eq(agroEntities.category, category as string));
      if (subCategory) filters.push(eq(agroEntities.subCategory, subCategory as string));
      if (productType) filters.push(eq(agroEntities.productType, productType as string));
      if (segment) filters.push(eq(agroEntities.segment, segment as string));
      if (segment2) filters.push(eq(agroEntities.segment2, segment2 as string));
      if (region) filters.push(eq(agroEntities.region, region as string));
      if (neighborhood) filters.push(ilike(agroEntities.neighborhood, `%${neighborhood}%`));
      if (cep) filters.push(like(agroEntities.cep, `%${cep}%`));
      if (email) filters.push(ilike(agroEntities.email, `%${email}%`));
      if (cpfCnpj) filters.push(like(agroEntities.cpfCnpj, `%${(cpfCnpj as string).replace(/\D/g, "")}%`));
      if (sourceFile) filters.push(eq(agroEntities.sourceFile, sourceFile as string));
      if (deliveryState) filters.push(eq(agroEntities.deliveryState, (deliveryState as string).toUpperCase()));
      if (deliveryCity) filters.push(ilike(agroEntities.deliveryCity, `%${deliveryCity}%`));

      if (createdFrom) {
        const d = new Date(createdFrom as string);
        if (!isNaN(d.getTime())) filters.push(gte(agroEntities.createdAt, d));
      }
      if (createdTo) {
        const d = new Date(createdTo as string);
        if (!isNaN(d.getTime())) { d.setDate(d.getDate() + 1); filters.push(lte(agroEntities.createdAt, d)); }
      }
      if (importedFrom) {
        const d = new Date(importedFrom as string);
        if (!isNaN(d.getTime())) filters.push(gte(agroEntities.importedAt, d));
      }
      if (importedTo) {
        const d = new Date(importedTo as string);
        if (!isNaN(d.getTime())) { d.setDate(d.getDate() + 1); filters.push(lte(agroEntities.importedAt, d)); }
      }

      if (search) {
        filters.push(
          or(
            ilike(agroEntities.name, `%${search}%`),
            like(agroEntities.cpfCnpj, `%${search}%`),
            like(agroEntities.code, `%${search}%`),
            ilike(agroEntities.email, `%${search}%`),
            ilike(agroEntities.phone, `%${search}%`),
            ilike(agroEntities.cellphone, `%${search}%`)
          )
        );
      }

      const sortColumns: Record<string, any> = {
        name: agroEntities.name,
        cpfCnpj: agroEntities.cpfCnpj,
        city: agroEntities.city,
        state: agroEntities.state,
        category: agroEntities.category,
        entityType: agroEntities.entityType,
        segment: agroEntities.segment,
        region: agroEntities.region,
        createdAt: agroEntities.createdAt,
        importedAt: agroEntities.importedAt,
      };
      const sortCol = sortColumns[sort as string] || agroEntities.createdAt;
      const orderFn = (order as string) === "asc" ? asc : desc;

      const parsedLimit = Math.max(1, Math.min(parseInt(limit as string) || 100, 500));
      const parsedOffset = Math.max(0, parseInt(offset as string) || 0);

      const whereClause = filters.length > 0 ? and(...filters) : undefined;

      const entities = await db.select().from(agroEntities)
        .where(whereClause)
        .orderBy(orderFn(sortCol))
        .limit(parsedLimit)
        .offset(parsedOffset);

      const countResult = await db
        .select({ count: sql<number>`count(*)` })
        .from(agroEntities)
        .where(whereClause);

      res.json({
        data: entities,
        total: Number(countResult[0]?.count || 0),
        limit: parsedLimit,
        offset: parsedOffset
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/entities/:id", async (req, res) => {
    try {
      const entity = await db.select()
        .from(agroEntities)
        .where(eq(agroEntities.id, parseInt(req.params.id)))
        .limit(1);

      if (entity.length === 0) {
        return res.status(404).json({ error: "Entidade nao encontrada" });
      }

      res.json(entity[0]);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/entities", async (req, res) => {
    try {
      const validated = insertAgroEntitySchema.parse(req.body);

      if (validated.cpfCnpj) {
        const existing = await db.select()
          .from(agroEntities)
          .where(eq(agroEntities.cpfCnpj, validated.cpfCnpj))
          .limit(1);

        if (existing.length > 0) {
          return res.status(409).json({
            error: "Entidade com este CPF/CNPJ ja existe",
            existingId: existing[0].id
          });
        }
      }

      const [newEntity] = await db.insert(agroEntities)
        .values({
          ...validated,
          sourceFile: "Manual",
        })
        .returning();

      res.status(201).json(newEntity);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.put("/api/entities/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const validated = insertAgroEntitySchema.partial().parse(req.body);

      const [updated] = await db.update(agroEntities)
        .set({
          ...validated,
          updatedAt: new Date(),
        })
        .where(eq(agroEntities.id, id))
        .returning();

      if (!updated) {
        return res.status(404).json({ error: "Entidade nao encontrada" });
      }

      res.json(updated);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.delete("/api/entities/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await db.delete(agroEntities).where(eq(agroEntities.id, id));
      res.status(204).send();
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/upload/preview", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "Nenhum arquivo enviado" });
      }

      const workbook = XLSX.readFile(req.file.path);
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_json(worksheet, { defval: null });

      fs.unlinkSync(req.file.path);

      if (data.length === 0) {
        return res.status(400).json({ error: "Planilha vazia" });
      }

      const columns = Object.keys(data[0] as object);
      const preview = data.slice(0, 5);

      res.json({
        fileName: req.file.originalname,
        totalRows: data.length,
        columns,
        preview
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/upload/import", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "Nenhum arquivo enviado" });
      }

      const { mapping, entityType } = req.body;

      if (!mapping || !entityType) {
        return res.status(400).json({
          error: "Mapeamento de colunas e tipo de entidade sao obrigatorios"
        });
      }

      const columnMapping = JSON.parse(mapping);

      const [fileUpload] = await db.insert(fileUploads)
        .values({
          fileName: req.file.originalname,
          fileSize: req.file.size,
          status: "processing"
        })
        .returning();

      const workbook = XLSX.readFile(req.file.path);
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_json(worksheet, { defval: null });

      let imported = 0;
      const errors: Array<{ row: number; error: string }> = [];

      for (let i = 0; i < data.length; i++) {
        try {
          const row = data[i] as any;
          const entity: any = {
            entityType,
            sourceFile: req.file.originalname,
            additionalData: {}
          };

          for (const [excelCol, dbField] of Object.entries(columnMapping)) {
            const value = row[excelCol];
            if (value !== null && value !== undefined && value !== "") {
              if (['name', 'cpfCnpj', 'code', 'state', 'city', 'region', 'category', 'subCategory', 'productType', 'phone', 'cellphone', 'address', 'neighborhood', 'cep', 'email', 'segment', 'segment2', 'birthDate', 'deliveryAddress', 'deliveryNeighborhood', 'deliveryCity', 'deliveryState', 'deliveryCep'].includes(dbField as string)) {
                entity[dbField as string] = String(value).trim();
              } else {
                entity.additionalData[dbField as string] = value;
              }
            }
          }

          if (entity.cpfCnpj) {
            const existing = await db.select()
              .from(agroEntities)
              .where(eq(agroEntities.cpfCnpj, entity.cpfCnpj))
              .limit(1);

            if (existing.length > 0) {
              errors.push({ row: i + 1, error: `CPF/CNPJ duplicado: ${entity.cpfCnpj}` });
              continue;
            }
          }

          await db.insert(agroEntities).values(entity);
          imported++;
        } catch (error: any) {
          errors.push({ row: i + 1, error: error.message });
        }
      }

      await db.update(fileUploads)
        .set({
          status: errors.length === data.length ? "error" : "completed",
          recordsImported: imported,
          errorMessage: errors.length > 0 ? JSON.stringify(errors.slice(0, 10)) : null
        })
        .where(eq(fileUploads.id, fileUpload.id));

      fs.unlinkSync(req.file.path);

      res.json({
        success: true,
        imported,
        total: data.length,
        errors: errors.slice(0, 10),
        fileUploadId: fileUpload.id
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/uploads", async (_req, res) => {
    try {
      const uploads = await db.select()
        .from(fileUploads)
        .orderBy(desc(fileUploads.uploadedAt))
        .limit(50);
      res.json(uploads);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/stats", async (_req, res) => {
    try {
      const totalEntities = await db
        .select({ count: sql<number>`count(*)` })
        .from(agroEntities);

      const byType = await db
        .select({
          entityType: agroEntities.entityType,
          count: sql<number>`count(*)`
        })
        .from(agroEntities)
        .groupBy(agroEntities.entityType);

      const byState = await db
        .select({
          state: agroEntities.state,
          count: sql<number>`count(*)`
        })
        .from(agroEntities)
        .where(sql`${agroEntities.state} IS NOT NULL`)
        .groupBy(agroEntities.state)
        .orderBy(desc(sql`count(*)`))
        .limit(10);

      res.json({
        totalEntities: Number(totalEntities[0]?.count || 0),
        byType,
        topStates: byState
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
}

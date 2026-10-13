import { Router } from "express";
import { validateBody } from "../../middlewares/validate.middleware.js";
import { createProductSchema, updateProductSchema, } from "./product.validation.js";
import { listProducts, getProductOptions, getProduct, createProduct, updateProduct, deactivateProduct, } from "./product.controller.js";
const router = Router();
// GET ALL PRODUCTS
router.get("/", listProducts);
// GET OPTIONS
// Must be registered before /:id
router.get("/options", getProductOptions);
// GET PRODUCT DETAIL
router.get("/:id", getProduct);
// CREATE PRODUCT
router.post("/", validateBody(createProductSchema), createProduct);
// UPDATE PRODUCT
router.patch("/:id", validateBody(updateProductSchema), updateProduct);
// SOFT DELETE PRODUCT
router.delete("/:id", deactivateProduct);
export default router;

import express from "express";
import { getMe, login, logout, refresh } from '../controllers/auth.controller.js';
import { authenticate } from '../middleware/authenticate.js';
const router = express.Router();


router.get("/me", authenticate, getMe)
router.post("/login", login)
router.post("/logout", logout) // We removed authenticate from logout since it needs to clear cookies even if token is expired
router.post("/refresh", refresh)


export default router;


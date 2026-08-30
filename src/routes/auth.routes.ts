import express from "express";
import { getMe, login, logout, refresh } from '../controllers/auth.controller.ts';
import { authenticate } from '../middleware/authenticate.ts';
const router = express.Router();


router.get("/me", authenticate, getMe)
router.post("/login", login)
router.post("/logout", logout) // We removed authenticate from logout since it needs to clear cookies even if token is expired
router.post("/refresh", refresh)


export default router;


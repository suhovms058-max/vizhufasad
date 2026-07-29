import express from "express";
import { createRequireSession } from "../auth/http.mjs";
import { WalletRepositoryError } from "./repository.mjs";

function respondError(response, error) {
  if (error instanceof WalletRepositoryError) {
    return response.status(error.status).json({ error: error.code });
  }
  throw error;
}

export function createWalletRouter({ authService, walletService }) {
  const router = express.Router();
  router.use(createRequireSession(authService));

  router.get("/", async (request, response, next) => {
    try {
      return response.json({ wallet: await walletService.summary(request.auth.user_id) });
    } catch (error) {
      try { return respondError(response, error); } catch (unexpected) { return next(unexpected); }
    }
  });
  router.get("/transactions", async (request, response, next) => {
    try {
      return response.json({
        transactions: await walletService.history(request.auth.user_id, request.query.limit),
      });
    } catch (error) {
      try { return respondError(response, error); } catch (unexpected) { return next(unexpected); }
    }
  });
  return router;
}

export function createCatalogRouter({ authService, walletService }) {
  const router = express.Router();
  router.use(createRequireSession(authService));
  router.get("/", async (request, response, next) => {
    try {
      return response.json(await walletService.catalog());
    } catch (error) {
      try { return respondError(response, error); } catch (unexpected) { return next(unexpected); }
    }
  });
  router.get("/tariffs", async (request, response, next) => {
    try {
      const catalog = await walletService.catalog();
      return response.json({ tariffs: catalog.tariffs, features: catalog.features });
    } catch (error) {
      try { return respondError(response, error); } catch (unexpected) { return next(unexpected); }
    }
  });
  router.get("/action-costs", async (request, response, next) => {
    try {
      const catalog = await walletService.catalog();
      return response.json({ actions: catalog.actions });
    } catch (error) {
      try { return respondError(response, error); } catch (unexpected) { return next(unexpected); }
    }
  });
  return router;
}

import { Router } from "express";
import customers from "../data/customers.json" with { type: "json" };
import aircraft from "../data/aircraft.json" with { type: "json" };
import maintenance from "../data/maintenance.json" with { type: "json" };
import deliveries from "../data/deliveries.json" with { type: "json" };

export const mockRouter = Router();
mockRouter.get("/customers/search", (req, res) => { const q = String(req.query.q ?? "").toLowerCase(); res.json(customers.filter((customer) => customer.name.toLowerCase().includes(q))); });
mockRouter.get("/fleet", (_req, res) => res.json(aircraft));
mockRouter.get("/fleet/customer/:customerId", (req, res) => res.json(aircraft.filter((item) => item.customerId === req.params.customerId)));
mockRouter.get("/aircraft/:id", (req, res) => { const item = aircraft.find((entry) => entry.id === req.params.id); if (!item) return res.status(404).json({ error: "Aircraft not found" }); return res.json(item); });
mockRouter.get("/maintenance/:aircraftId", (req, res) => res.json(maintenance.filter((item) => item.aircraftId === req.params.aircraftId)));
mockRouter.get("/deliveries/customer/:customerId", (req, res) => res.json(deliveries.filter((item) => item.customerId === req.params.customerId)));

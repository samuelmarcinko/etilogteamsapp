const express = require('express');
const router = express.Router();
const FleetVehicle = require('../database/models/FleetVehicle');
const { verifyToken } = require('../middleware/auth');
const { attachDbRole, requireDbRole } = require('../middleware/portalAuth');
const { asyncHandler } = require('../middleware/errorHandler');

// All fleet routes require admin role
router.use(verifyToken, attachDbRole, requireDbRole('admin'));

// GET /api/fleet - Get all vehicles
router.get('/', asyncHandler(async (req, res) => {
  const vehicles = await FleetVehicle.findAll();
  res.json({ data: vehicles });
}));

// GET /api/fleet/:id - Get single vehicle
router.get('/:id', asyncHandler(async (req, res) => {
  const vehicle = await FleetVehicle.findById(req.params.id);
  if (!vehicle) return res.status(404).json({ error: 'Vehicle not found' });
  res.json({ data: vehicle });
}));

// POST /api/fleet - Create vehicle
router.post('/', asyncHandler(async (req, res) => {
  const { name, license_plate, notification_email } = req.body;
  if (!name || !license_plate || !notification_email) {
    return res.status(400).json({ error: 'name, license_plate and notification_email are required' });
  }
  const vehicle = await FleetVehicle.create(req.body);
  res.status(201).json({ data: vehicle });
}));

// PUT /api/fleet/:id - Update vehicle
router.put('/:id', asyncHandler(async (req, res) => {
  const vehicle = await FleetVehicle.update(req.params.id, req.body);
  if (!vehicle) return res.status(404).json({ error: 'Vehicle not found' });
  res.json({ data: vehicle });
}));

// PATCH /api/fleet/:id/toggle - Toggle active status
router.patch('/:id/toggle', asyncHandler(async (req, res) => {
  const vehicle = await FleetVehicle.toggleActive(req.params.id);
  if (!vehicle) return res.status(404).json({ error: 'Vehicle not found' });
  res.json({ data: vehicle });
}));

// DELETE /api/fleet/:id - Delete vehicle
router.delete('/:id', asyncHandler(async (req, res) => {
  await FleetVehicle.delete(req.params.id);
  res.json({ message: 'Vehicle deleted' });
}));

module.exports = router;

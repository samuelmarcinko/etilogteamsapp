const SickNote = require('../database/models/SickNote');
const path = require('path');
const fs = require('fs');

class SickNoteController {
  /**
   * Create a new sick note
   * POST /api/sick-notes
   */
  static async create(req, res, next) {
    try {
      const { title, description, start_date, end_date, doctor_name, diagnosis } = req.body;

      if (!title || !start_date || !end_date) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Title, start_date and end_date are required'
        });
      }

      const data = {
        userId: req.user.id,
        userName: req.user.name,
        userEmail: req.user.email,
        title,
        description,
        startDate: start_date,
        endDate: end_date,
        doctorName: doctor_name,
        diagnosis
      };

      // Handle file upload
      if (req.file) {
        data.filePath = req.file.path;
        data.fileName = req.file.originalname;
        data.fileType = req.file.mimetype;
        data.fileSize = req.file.size;
      }

      const sickNote = await SickNote.create(data);

      res.status(201).json({
        success: true,
        message: 'Sick note created successfully',
        data: sickNote
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get my sick notes
   * GET /api/sick-notes/me
   */
  static async getMySickNotes(req, res, next) {
    try {
      const notes = await SickNote.findByUserId(req.user.id);

      res.json({
        success: true,
        count: notes.length,
        data: notes
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get sick note by ID
   * GET /api/sick-notes/:id
   */
  static async getById(req, res, next) {
    try {
      const note = await SickNote.findById(req.params.id);

      if (!note) {
        return res.status(404).json({
          error: 'Not Found',
          message: 'Sick note not found'
        });
      }

      // Users can only see their own, admins can see all
      if (note.user_id !== req.user.id && req.userRole !== 'admin') {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'Access denied'
        });
      }

      res.json({ success: true, data: note });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get all sick notes (admin)
   * GET /api/sick-notes
   */
  static async getAll(req, res, next) {
    try {
      const filters = {};
      if (req.query.userId) filters.userId = req.query.userId;
      if (req.query.status) filters.status = req.query.status;
      if (req.query.year) filters.year = parseInt(req.query.year);

      const notes = await SickNote.findAll(filters);

      res.json({
        success: true,
        count: notes.length,
        data: notes
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update sick note
   * PUT /api/sick-notes/:id
   */
  static async update(req, res, next) {
    try {
      const note = await SickNote.findById(req.params.id);

      if (!note) {
        return res.status(404).json({
          error: 'Not Found',
          message: 'Sick note not found'
        });
      }

      // Users can only edit their own
      if (note.user_id !== req.user.id && req.userRole !== 'admin') {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'Access denied'
        });
      }

      const updated = await SickNote.update(req.params.id, {
        title: req.body.title,
        description: req.body.description,
        startDate: req.body.start_date,
        endDate: req.body.end_date,
        doctorName: req.body.doctor_name,
        diagnosis: req.body.diagnosis,
        status: req.body.status
      });

      res.json({
        success: true,
        message: 'Sick note updated',
        data: updated
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Upload file for sick note
   * POST /api/sick-notes/:id/upload
   */
  static async uploadFile(req, res, next) {
    try {
      const note = await SickNote.findById(req.params.id);

      if (!note) {
        return res.status(404).json({
          error: 'Not Found',
          message: 'Sick note not found'
        });
      }

      if (note.user_id !== req.user.id && req.userRole !== 'admin') {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'Access denied'
        });
      }

      if (!req.file) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'No file uploaded'
        });
      }

      // Delete old file if exists
      if (note.file_path) {
        try {
          fs.unlinkSync(note.file_path);
        } catch (e) {
          // Ignore if file doesn't exist
        }
      }

      const updated = await SickNote.updateFile(
        req.params.id,
        req.file.path,
        req.file.originalname,
        req.file.mimetype,
        req.file.size
      );

      res.json({
        success: true,
        message: 'File uploaded successfully',
        data: updated
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Download file for sick note
   * GET /api/sick-notes/:id/file
   */
  static async downloadFile(req, res, next) {
    try {
      const note = await SickNote.findById(req.params.id);

      if (!note) {
        return res.status(404).json({
          error: 'Not Found',
          message: 'Sick note not found'
        });
      }

      if (note.user_id !== req.user.id && req.userRole !== 'admin') {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'Access denied'
        });
      }

      if (!note.file_path) {
        return res.status(404).json({
          error: 'Not Found',
          message: 'No file attached'
        });
      }

      if (!fs.existsSync(note.file_path)) {
        return res.status(404).json({
          error: 'Not Found',
          message: 'File not found on server'
        });
      }

      res.download(note.file_path, note.file_name);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Delete sick note
   * DELETE /api/sick-notes/:id
   */
  static async delete(req, res, next) {
    try {
      const note = await SickNote.findById(req.params.id);

      if (!note) {
        return res.status(404).json({
          error: 'Not Found',
          message: 'Sick note not found'
        });
      }

      if (note.user_id !== req.user.id && req.userRole !== 'admin') {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'Access denied'
        });
      }

      // Delete file if exists
      if (note.file_path) {
        try {
          fs.unlinkSync(note.file_path);
        } catch (e) {
          // Ignore
        }
      }

      await SickNote.delete(req.params.id);

      res.json({
        success: true,
        message: 'Sick note deleted'
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get sick note stats for a user
   * GET /api/sick-notes/stats/:userId
   */
  static async getUserStats(req, res, next) {
    try {
      const userId = req.params.userId || req.user.id;
      const year = parseInt(req.query.year) || new Date().getFullYear();

      const stats = await SickNote.getUserStats(userId, year);

      res.json({
        success: true,
        data: {
          ...stats,
          total_notes: parseInt(stats.total_notes),
          active_notes: parseInt(stats.active_notes),
          total_days: parseInt(stats.total_days) || 0
        }
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = SickNoteController;

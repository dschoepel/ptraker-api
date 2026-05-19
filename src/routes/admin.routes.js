'use strict';

const express = require('express');
const router  = express.Router();
const adminController = require('../controllers/admin.controller');
const { requireAuth }  = require('../middleware/auth');

const { requireAdmin } = adminController;

// All admin routes require auth + admin role
router.use(requireAuth, requireAdmin);

// GET  /api/v1/admin/users
router.get('/users', adminController.getUsers);

// POST /api/v1/admin/invite
router.post('/invite', adminController.inviteUser);

// PATCH /api/v1/admin/users/:id
router.patch('/users/:id', adminController.updateUserRole);

// GET  /api/v1/admin/role-requests
router.get('/role-requests', adminController.getRoleRequests);

// PATCH /api/v1/admin/role-requests/:id
router.patch('/role-requests/:id', adminController.reviewRoleRequest);

// GET  /api/v1/admin/notification-settings
router.get('/notification-settings', adminController.getNotificationSettings);

// PATCH /api/v1/admin/notification-settings
router.patch('/notification-settings', adminController.updateNotificationSettings);

// POST /api/v1/admin/notification-settings/test
router.post('/notification-settings/test', adminController.testNotificationSettings);

// DELETE /api/v1/admin/users/:id
router.delete('/users/:id', adminController.deleteUser);

module.exports = router;

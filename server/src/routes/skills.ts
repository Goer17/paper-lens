import { Router } from 'express';
import multer from 'multer';
import { db } from '../db.js';
import { HttpError } from '../http.js';
import {
  deleteSkill,
  getSkill,
  installSkill,
  listSkillFiles,
  listSkills,
  readSkillInstructions,
} from '../services/skills.js';

export const skillsRouter = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024, files: 1 },
});

skillsRouter.get('/', (_req, res) => {
  res.json({
    skills: listSkills().map((skill) => ({
      ...skill,
      agent_ready: true,
    })),
  });
});

skillsRouter.post('/', upload.single('file'), (req, res) => {
  const file = req.file;
  if (!file) throw new HttpError(400, 'Attach a skill .zip archive.');
  if (!file.originalname.toLowerCase().endsWith('.zip')) {
    throw new HttpError(400, 'Skills must be uploaded as a .zip archive.');
  }
  const fallbackName = file.originalname.replace(/\.zip$/i, '').slice(0, 120) || 'Untitled skill';
  let skill;
  try {
    skill = installSkill(file.buffer, fallbackName);
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, 'The zip archive could not be read.');
  }
  res.status(201).json({ skill, files: listSkillFiles(skill) });
});

skillsRouter.get('/:id', (req, res) => {
  const skill = getSkill(req.params.id);
  if (!skill) throw new HttpError(404, 'Skill not found.');
  res.json({
    skill,
    files: listSkillFiles(skill),
    instructions: readSkillInstructions(skill),
  });
});

skillsRouter.delete('/:id', (req, res) => {
  if (!deleteSkill(req.params.id)) throw new HttpError(404, 'Skill not found.');
  res.json({ ok: true });
});

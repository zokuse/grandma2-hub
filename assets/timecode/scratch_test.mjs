import fs from 'fs';
import { parseReaperProject } from './src/lib/ReaperParser.js';

const content = fs.readFileSync('C:/Users/zokuse/Documents/CKS 2025 LS/CKS 2025 LS.rpp', 'utf-8');
const result = parseReaperProject(content);

console.log(JSON.stringify(result.audioFiles, null, 2));

#!/usr/bin/env node
import { main } from '../dist/run.js';

process.exitCode = await main(process.argv.slice(2));

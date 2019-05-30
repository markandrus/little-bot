#!/usr/bin/env node
'use strict';

const {
  error,
  loadPage
} = require('../lib');

async function main() {
  await loadPage();
}

main().catch(({ stack }) => {
  error(stack);
  process.exit(1);
});

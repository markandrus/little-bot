#!/usr/bin/env node
'use strict';

require('dotenv').config();

const {
  TWILIO_PHONE_NUMBER_TO_1,
  TWILIO_PHONE_NUMBER_TO_2,
  URL_1,
  URL_2
} = process.env;

const {
  error,
  loadPage
} = require('../lib');

async function main() {
  await loadPage(URL_1, TWILIO_PHONE_NUMBER_TO_1);
  await loadPage(URL_2, TWILIO_PHONE_NUMBER_TO_2);
}

main().catch(({ stack }) => {
  error(stack);
  process.exit(1);
});

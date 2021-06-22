'use strict';

const puppeteer = require('puppeteer');
const createClient = require('twilio');

require('dotenv').config();

const {
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_PHONE_NUMBER_FROM,
  TWILIO_PHONE_NUMBER_TO,
  URL
} = process.env;

async function loadPage() {
  const chromeOptions = {
    // headless: false
  };

  log('Launching Chrome');
  const browser = await puppeteer.launch(chromeOptions);

  log('Opening new page');
  const page = await browser.newPage();

  log('Navigating to initial appointments page');
  await page.goto(URL);
  const initialUrl = await page.evaluate(`
    document.querySelector('.zmstermin-multi a').href
  `);
  await page.goto(initialUrl);

  let hasNextPage = true;
  while (hasNextPage) {
    log('Checking if page has appointment');
    const hasAppointment = await checkPage(page);
    if (hasAppointment) {
      log('There appears to be an appointment! Sending text message');
      const message = createText();
      await sendText(message);
      log('Sent text message');
      await browser.close();
      return;
    }
    log('This page doesn\'t have any appointments');
    hasNextPage = await getNextPage(page);
    if (hasNextPage) {
      log('Navigating to subsequent appointments page');
    }
  }

  log('No more pages to check. Bye-bye');
  await browser.close();
}

async function checkPage(page) {
  const appointmentDates = await page.evaluate(`
    Array.prototype.slice.call(document.querySelectorAll('.buchbar'), 1)
  `);

  return !!appointmentDates.length;
}

async function getNextPage(page) {
  const nextPageUrl = await page.evaluate(`
    document.querySelector('.next a') && document.querySelector('.next a').href
  `);

  if (nextPageUrl) {
    await page.goto(nextPageUrl);
  }
  return !!nextPageUrl;
}

function error(message) {
  const now = new Date().toUTCString();
  console.error(`${now} [error] - ${message}`);
}

function log(message) {
  const now = new Date().toUTCString();
  console.log(`${now} [info] - ${message}`);
}

function createText() {
  return 'An appointment is available!';
}

function sendText(body) {
  const client = createClient(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
  return client.messages.create({
    body,
    from: TWILIO_PHONE_NUMBER_FROM,
    to: TWILIO_PHONE_NUMBER_TO
  });
}

module.exports = {
  error,
  loadPage
};

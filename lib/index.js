'use strict';

const FormData = require('form-data');
const { writeFileSync } = require('fs');
const { decode } = require('image-data-uri');
const fetch = require('node-fetch');
const poll = require('promise-poller').default;
const puppeteer = require('puppeteer');
const { fileSync } = require('tmp');
const createClient = require('twilio');

require('dotenv').config();

const {
  CAPTCHA_API_KEY,
  EARLIER_THAN_DAY,
  EARLIER_THAN_MONTH,
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_PHONE_NUMBER_FROM,
  TWILIO_PHONE_NUMBER_TO,
  URL,
} = process.env;

async function loadPage() {
  const chromeOptions = {
    // headless: false
  };

  log('Launching Chrome');
  const browser = await puppeteer.launch(chromeOptions);

  log('Opening new page');
  const page = await browser.newPage();

  const maxAttempts = 3;
  let attempts = maxAttempts;
  while (true) {
    let captchaError = null;

    try {
      await answerTheCaptcha(page);

      log('Waiting to see if we answered the Captcha correctly');
      captchaError = await Promise.race([
        waitForError(page),
        waitForSuccess(page)
      ]);
    } catch (error) {
      captchaError = error;
    }

    if (!captchaError) {
      log('Successfully answered the Captcha correctly');
      break;
    } else if (--attempts >= 0) {
      error(`Failed to answer the Captcha correctly; retrying (${maxAttempts - attempts} of ${maxAttempts})`);
    } else {
      throw new Error('Failed to answer the Captcha correctly; giving up!');
    }
  }

  log('Getting the next appointment date');
  const appointmentDate = await page.evaluate(`
    document.querySelector('h4').innerText
  `);

  const message = createText(appointmentDate);
  log(message);

  if (isInterestingAppointmentDate(appointmentDate)) {
    log("That's an interesting appointment date! Sending text message");
    await sendText(message);
    log('Sent text message');
  } else {
    log("Unfortunately, that's not a very interesting appointment date.");
    log(`We're looking for something earlier than ${EARLIER_THAN_DAY}.${EARLIER_THAN_MONTH}`);
  }

  log('Bye-bye');
  await browser.close();
}

async function waitForError(page) {
  try {
    await page.waitForSelector('#message');
    return new Error('Answering the Captcha failed');
  } catch (error) {
    // Do nothing.
  }
}

async function waitForSuccess(page) {
  try {
    await page.waitForSelector('h4');
  } catch (error) {
    return new Error('The calendar did not load');
  }
}

async function answerTheCaptcha(page) {
  log('Navigating to Captcha page');
  await page.goto(URL);

  log('Waiting for Captcha to appear');
  await page.waitForSelector('captcha > div');

  log('Extracting Data URI');
  const imageDataUri = stripUrlWrapper(await page.evaluate(`
    document.querySelector('captcha > div').style.backgroundImage
  `));

  log('Decoding Data URI');
  const imageData = decode(imageDataUri);
  const { dataBuffer, imageType } = imageData;
  const { byteLength } = dataBuffer;
  log(`Data URI contains ${byteLength} bytes of ${imageType} data`);

  log('Creating temporary file');
  const captchaFile = fileSync({
    keep: true,
    postfix: '.jpeg'
  });
  const { name } = captchaFile;
  log(`Created temporary file ${name}`);

  log(`Writing ${byteLength} bytes of ${imageType} data to ${name}`);
  writeFileSync(captchaFile.fd, dataBuffer);
  log(`Wrote ${byteLength} bytes of ${imageType} data to ${name}`);

  log('Sending to 2Captcha');
  const requestId = await sendTo2Captcha(imageData);
  log(`2Captcha Request ID is ${requestId}`);

  log(`Begin polling for 2Captcha Response`);
  const captchaResponse = await pollForRequestResults(requestId);
  log(`Got 2Captcha Response: ${captchaResponse}`);

  log('Typing in the Captcha');
  await page.evaluate(`
    document.getElementById('appointment_captcha_month_captchaText').value = '${captchaResponse}';
  `);

  log('Clicking "Continue"');
  await page.click('#appointment_captcha_month_appointment_showMonth');
}

function error(message) {
  const now = new Date().toUTCString();
  console.error(`${now} [error] - ${message}`);
}

function log(message) {
  const now = new Date().toUTCString();
  console.log(`${now} [info] - ${message}`);
}

function stripUrlWrapper(url) {
  return url.split('"')[1];
}

async function sendTo2Captcha(imageData) {
  const form = new FormData();
  form.append('key', CAPTCHA_API_KEY);
  form.append('method', 'base64');
  form.append('regsense', 1);
  form.append('json', 1);
  form.append('body', imageData.dataBuffer.toString('base64'));

  const response = await fetch('https://2captcha.com/in.php', {
    method: 'POST',
    body: form
  });

  const request = await response.json();

  if (!request.status) {
    throw new Error(request.request);
  }

  return request.request;
}

function createText(when) {
  return `An appointment is available ${when}!`;
}

function sendText(body) {
  const client = createClient(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
  return client.messages.create({
    body,
    from: TWILIO_PHONE_NUMBER_FROM,
    to: TWILIO_PHONE_NUMBER_TO
  });
}

async function requestCaptchaResults(requestId) {
  const apiKey = CAPTCHA_API_KEY;
  const url = `http://2captcha.com/res.php?key=${apiKey}&action=get&id=${requestId}&json=1`;
  const response = await fetch(url);
  const request = await response.json();
  if (!request.status) {
    throw new Error(request.request);
  }
  return request.request;
}

async function pollForRequestResults(requestId, retries = 30, interval = 1500, delay = 15000) {
  await timeout(delay);
  return poll({
    taskFn: () => requestCaptchaResults(requestId),
    interval,
    retries
  });
}

function timeout(ms) {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

function parseAppointmentDate(appointmentDate) {
  let [day, month] = appointmentDate.trim().split(' ')[1].split('.');
  return {
    day: Number.parseInt(day),
    month: Number.parseInt(month)
  };
}

function isInterestingAppointmentDate(appointmentDate) {
  try {
    const { day, month } = parseAppointmentDate(appointmentDate);
    if (month > Number.parseInt(EARLIER_THAN_MONTH)) {
      return false;
    }
    if (day >= Number.parseInt(EARLIER_THAN_DAY)) {
      return false;
    }
  } catch (error) {
    // Well, it failed to parse. That's at least interesting.
  }
  return true;
}

module.exports = {
  error,
  loadPage
};

// ==UserScript==
// @name         Autoklicker
// @namespace    http://tampermonkey.net/
// @version      2024-01-20
// @description  try to take over the world!
// @author       You
// @match        https://zone1.armywars.com/t
// @icon         https://www.google.com/s2/favicons?sz=64&domain=armywars.com
// @require      https://docs.opencv.org/4.5.5/opencv.js
// @run-at       document-start
// @grant        GM_registerMenuCommand
// ==/UserScript==
console.log("startBuilding");

const originalSend = WebSocket.prototype.send;
window.sockets = [];
WebSocket.prototype.send = function(...args) {
  if (window.sockets.indexOf(this) === -1) {
    window.sockets.push(this);
      this.addEventListener('message', function(event) {
      const message = event.data;

      if (message.includes("captha")) {
          const jsonObject = JSON.parse(message);
          if(jsonObject.a == 12) {
          latestCaptch = jsonObject.p.vl[0][2];
          console.log("code received: ");
          } else {
              console.log(jsonObject.p);
          }
      }
      if (message.includes("gate_delta")) {
          currentMapID = JSON.parse(message).p.r[0];
          if(homeMapID == 0) {
              console.log("set home Map to: ", currentMapID);
              homeMapID = currentMapID;
          }
      }

  })
  }
  return originalSend.call(this, ...args);
};


const canvas = document.createElement('canvas');
canvas.width = 200;
canvas.height = 30;
canvas.style.display = 'none';
canvas.id = 'output'
document.body.appendChild(canvas);

function getBase() {
  var base_id = [];
  for (const enemy of document.getElementsByClassName('enemy enemy_8')) {
      if (enemy.classList.contains('air_base')) continue;
      var ene_id = enemy.id;
      var split = ene_id.split("_");
      base_id.push(parseInt(split[1]));
  }
  for (const enemy of document.getElementsByClassName('enemy enemy_100')) {
      if (enemy.classList.contains('air_base')) continue;
      ene_id = enemy.id;
      split = ene_id.split("_");
      base_id.push(parseInt(split[1]));
  }
  return base_id;
}

var baseUnten = 833408;
var favID = 1;
var latestCaptch = "";
var latestXY = [0, 0];
var solvedCaptchas;
var baseIds;
var logging = false;
var cycling = false;
var notFull = ['carbon','fuel','steel','cement'];
var homeMapID = 0;
var currentMapID = 0;
const validNames = ['carbon','fuel','steel','cement']
window.currentProduction = '';

const workerCode = `self.onmessage = function(event) {
const sleepTime = event.data;
setTimeout(() => {
  self.postMessage(sleepTime/1000);
}, sleepTime);
};`
const blob = new Blob([workerCode], {type: 'application/javascript'});
const workerUrl = URL.createObjectURL(blob);



function checkResources() {
  var full = [];
  for (let resourceName of notFull) {
      console.log(resourceName);
      var value = parseInt(document.getElementsByClassName('resource-'+ resourceName)[0].childNodes[0].textContent.replace(/\./g,''))
      if(value > 149000000) {
          console.log("Lagerkapazität erreicht: ", resourceName);
          full.push(resourceName);
      }
  }
  notFull = notFull.filter(item => !full.includes(item));
  if(!notFull.includes(window.currentProduction)) {
      if(notFull.length == 0) {
          cycle = false;
          alert("alle Lager voll");
      }
      else {
          window.currentProduction = notFull[0];
      }
  }
}

async function produce(resource, baseID) {
    const captchaXY = await getNewestXY();

  if(resource == 'fuel') {
      resource = 'oil';
  }
  console.log("try prducing ",resource, " with ", captchaXY, "on map: ", homeMapID);
  window.sockets[0].send(JSON.stringify({
      "a": 13,
      "c": 1,
      "p": {
          "c": "object.extract",
          "r": homeMapID,
          "p": {
              "base_id": baseID,
              "name": resource,
              "command": 1,
              "x": parseInt(captchaXY[0]),
              "y": parseInt(captchaXY[1])
          }
      }
  }))
}

async function sleep(ms) {
  return await new Promise(resolve => {
      const sleeper = new Worker(workerUrl);

      sleeper.onmessage = function(event) {
          resolve(event.data);
          sleeper.terminate();
      };

      sleeper.postMessage(ms);
  });

  //return new Promise(resolve=>setTimeout(resolve, ms));
}

// Funktion zum Laden eines Bildes und Rückgabe eines Promises
function loadImage(src) {
  return new Promise((resolve,reject)=>{
      const image = new Image();
      image.onload = ()=>resolve(image);
      image.onerror = reject;
      image.src = src;
  }
  );
}

function findContures(image) {
  const grayImage = new cv.Mat();

  cv.cvtColor(image, grayImage, cv.COLOR_RGBA2GRAY);

  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  cv.findContours(grayImage, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

  var largestCon;
  var largestVolPer = 0;
  for (let i = 0; i < contours.size(); i++) {
      const con = contours.get(i);
      const area = cv.contourArea(con);
      const perimeter = cv.arcLength(con, true);
      const volPer = area / perimeter;
      //console.log(perimeter, area, volPer);
      if (volPer > largestVolPer) {
          largestVolPer = volPer;
          largestCon = con;
      }
  }

  // Calculate the moments of the contour
  const moments = cv.moments(largestCon);

  // Calculate the center of mass (weighted centroid) of the contour
  const cx = parseInt(moments.m10 / moments.m00);
  const cy = parseInt(moments.m01 / moments.m00);

  //tidy up
  grayImage.delete();
  contours.delete();
  hierarchy.delete();
  largestCon.delete();

  return [cx, cy]
}

async function readImage(imageSrc) {

  //draw image to output canvas, appanded at top
  const image = await loadImage(imageSrc);
  const canvas = document.getElementById('output');
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'black';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0);

  return cv.imread('output', cv.IMREAD_UNCHANGED);
}

async function getNewestXY() {
    var noCaptcha = 0;
  while (cycle && (latestCaptch == "" || currentMapID != homeMapID)) {
      console.log("no captcha found or not on homeMap");

      if(latestCaptch == "") {
          noCaptcha == 12 && alert("kein Captcha gefunden. Versuche einmal manuell Produktion zu starten");
          noCaptcha++;
      }
      timer = 0;
      await sleep(5000);
  }
  const cvImg = await readImage(latestCaptch);
  latestXY = findContures(cvImg);
  solvedCaptchas = [latestCaptch, latestXY];
  latestCaptch = "";

  cvImg.delete();
  return latestXY;
}

async function produceAll(resourceName) {

  for (var i = 0; i < baseIds.length; i++) {
      if(!cycle) return;
      await produce(resourceName, baseIds[i]);
      await sleep(500);
  }
  cycles++;
  console.log(cycles, " cycles completed");
}

var cycle = true;
var cyleFunction;
var timer = 0;
var cycles = 0;

async function startCycle(resourceName = 'carbon') {
  if(cycling) {
      console.log("cycle already running. Set cycling = false");
      return;
  }
  notFull = ['carbon','fuel','steel','cement'];
  window.currentProduction = resourceName;
  cycle = true;
  cycling = true;
  cycles = 0;

  baseIds = getBase();
  while (cycle) {
      checkResources();
      produceAll(window.currentProduction);
      timer = 0;
      while (timer < 310 && cycle) {
          timer += await sleep(5000);
      }

  }
  cycling = false;
  return true;
}

function stopCycle() {
  cycle = false;
}


(function() {
    'use strict';

    // Add a context menu option
    GM_registerMenuCommand('starte Produktion für Zement', function() {startCycle('cement')});
    GM_registerMenuCommand('starte Produktion für carbon', startCycle);
    GM_registerMenuCommand('starte Produktion für Stahl', function() {startCycle('fuel')});
    GM_registerMenuCommand('starte Produktion für Treibstoff', function() {startCycle('fuel')});
    GM_registerMenuCommand('stoppe Produktion', stopCycle);
})();

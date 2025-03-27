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
console.log("Autocklicker script injected");

//old websocket send function
const originalSend = WebSocket.prototype.send;

window.sockets = [];


//override websocket.send
WebSocket.prototype.send = function(...args) {
  if (window.sockets.indexOf(this) === -1) {
      window.sockets.push(this);
      this.addEventListener('message', function(event) {
      const message = event.data;

          //intercept captcha codes
      if (message.includes("captha") && message.includes(userID)) {
          const jsonObject = JSON.parse(message);
          if(jsonObject.a == 12) {
          latestCaptch = jsonObject.p.vl[0][2];
          console.log("code received");
          }
      }

          //intercept map
      if (message.includes("gate_delta")) {
          currentMapID = JSON.parse(message).p.r[0];
          if(homeMapID == 0) {
              console.log("set home Map to: ", currentMapID);
              homeMapID = currentMapID;
          }
      }

          //intercept user code
          if(message.includes('"un"')) {
              userID = JSON.parse(message).p.id;
              console.log('found new user id: ' + userID);
          }


      //try to intercept 'not-ready' message
          if (message.includes('"a":29')) {
              //console.log('message intercepted: ' + message);
              //return;
          }

  })
  }
  return originalSend.call(this, ...args);
};

//workaround to get base64 into a cv image
const canvas = document.createElement('canvas');
canvas.width = 200;
canvas.height = 30;
canvas.style.display = 'none';
canvas.id = 'output'

//script is executed before body is initialized
if(!document.body) alert("Fehler beim Laden des Scripts. Seite neu laden und bitte mir melden, will wissen ob das öfters vorkommt");
document.body.appendChild(canvas);

//derive Base ids from minimap. enemy_100 colorblind mode
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
var userID = 0;
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

//weird sleep function, probably better solution
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
      var value = parseInt(document.getElementsByClassName('resource-'+ resourceName)[0].childNodes[0].textContent.replace(/\./g,''))
      if(value > 149000000) {
          console.log("Lagerkapazität erreicht: ", resourceName);
          full.push(resourceName);
      }
  }
  notFull = notFull.filter(item => !full.includes(item));
  if(!notFull.includes(window.currentProduction)) {
      //stop by length 1 if you dont want to produce cement
      if(notFull.length == 1) {
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
    //console.log("start timer with (ms): ", ms);
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
          //noCaptcha == 12 && alert("kein Captcha gefunden. Versuche einmal manuell Produktion zu starten");
          console.log('no captcha: ' + noCaptcha++);
      }
      resetTimer = true;
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
window.timer = 0;
var cycles = 0;
var resetTimer;
var observer
function closeInfobox() {
    if(observer) return;//only adds observer once
    var container = document.getElementById("main");
//    document.styeSheets[3].rules[
    observer = new MutationObserver(function(mutationsList, observer) {
       for(var mutation of mutationsList) {
            if(mutation.type === 'childList') {
                for (var node of mutation.addedNodes) {
                    if(node.nodeType === 1 && node.classList.contains('detailed-error-messages-mask')) {
                           var nodes = node.querySelectorAll('.btn-armywars');
                           if(nodes && nodes.length == 1) {
                               nodes[0].click();
                               console.log("Captcha Missclick notification closed");
                           } else {
                               alert("multiple buttons found, bitte mir melden");
                           }
                       }
                }
            }
       }
    })

    var observerConfig = {childList: true};
    observer.observe(container, observerConfig);
}

async function startCycle(resourceName = 'carbon') {
  homeMapID = currentMapID;
  closeInfobox();
  if(cycling) {
      console.log("cycle already running. Set cycling = false");
      alert("Es wurde bereits eine Produktion gestartet. Wähle Produktion Stoppen, um etwas anderes zu Produzieren.")
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
      window.timer = 0;
      while (window.timer < 300 && cycle) {
          if(resetTimer) {
              window.timer = 0;
              resetTimer = false;
          }
          window.timer += await sleep(5000);
          console.log(window.timer);
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
    GM_registerMenuCommand('starte Produktion für Stahl', function() {startCycle('steel')});
    GM_registerMenuCommand('starte Produktion für Treibstoff', function() {startCycle('fuel')});
    GM_registerMenuCommand('stoppe Produktion', stopCycle);
    //sets observer to true, so that closeInfobox returns early
    GM_registerMenuCommand('Captcha Infobox nicht automatisch schließen', function (){observer = 1});

})();



//grok-generated: disable focus related events
(function() {
    'use strict';

    // Step 1: Spoof visibility properties
    // Make the tab appear always visible
    Object.defineProperty(document, 'hidden', {
        get: () => false,
        configurable: true
    });

    Object.defineProperty(document, 'visibilityState', {
        get: () => 'visible',
        configurable: true
    });

    // Step 2: Block visibilitychange events
    document.addEventListener('visibilitychange', (e) => {
        e.stopImmediatePropagation();
        e.preventDefault();
        console.log('Blocked visibilitychange event');
    }, { capture: true, passive: false });

    // Step 3: Neutralize focus/blur events
    window.onblur = () => {
        console.log('Blur event ignored');
    };
    window.onfocus = () => {
        console.log('Focus event ignored');
    };
    window.blur = () => {}; // No-op
    window.focus = () => {}; // No-op

    // Step 4: Intercept and block focus-related event listeners
    const originalAddEventListener = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function(type, listener, options) {
        if (type === 'blur' || type === 'focus' || type === 'visibilitychange') {
            console.log(`Blocked ${type} event listener`);
            return; // Do nothing
        }
        originalAddEventListener.call(this, type, listener, options);
    };

    // Step 5: Ensure requestAnimationFrame keeps running
    const originalRequestAnimationFrame = window.requestAnimationFrame;
    window.requestAnimationFrame = function(callback) {
        // If tab is hidden, fall back to setTimeout to keep the loop alive
        if (document.hidden) {
            setTimeout(() => callback(performance.now()), 16); // ~60 FPS
        } else {
            originalRequestAnimationFrame(callback);
        }
    };

    // Optional: Log to confirm
    console.log('Focus-related events disabled at browser level');
})();

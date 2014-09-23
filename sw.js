console.log("I am a Service Worker");

var db;
var version = 2.0;

function initDb() {
  var request = indexedDB.open("TestDatabaseV" + version);
  request.onerror = function(evt) {
    console.log("Database error code: " + evt.target.errorCode);
  };
  request.onsuccess = function(evt) {
    db = request.result; 
  };
  request.onupgradeneeded = function (evt) {                   
    var objectStore = evt.currentTarget.result.createObjectStore(
        "requests", { keyPath: "request" });
  };
}
initDb();

this.addEventListener('install', function(e) {
  console.log("I am a Service Worker and I have been installed");
});

this.addEventListener('activate', function(e) {
  console.log("I am a Service Worker and I have been activated");
});

// Resolves with the first promise that resolves, or rejects if all 
// promises reject.
// Similar to Promise.race, except that promises that rejects are ignored
// unless all promises have rejected, in which case the arguments from all
// promise rejects are returned in a list to the reject handler.
function raceSucceed(promises) {
  return new Promise(function(resolve, reject) {
    var promisesThrown = 0;
    var drop = false;
    var errors = [];
    for (var i = 0; i < promises.length; i++) {
      var curr = i;
      promises[i].then(function(result) {
        if (!drop && errors[curr] == undefined) {
          console.log("Promise " + curr + " won!");
          drop = true;
          resolve(result);
        }
      }, function(error) {
        console.log("Promise " + curr + " had an error!");
        errors[curr] = error;
        promisesThrown += 1;
        if (promisesThrown == promises.length) {
          reject(errors);
        }
      });
    }
  });
}

// Request handling
this.addEventListener('fetch', function(event) {
  console.log("I'm in fetch!");
  console.log(event.request.url);
  if (event.request.url == "http://localhost:8080/sw.js" || !db) {
    console.log("Database isn't initialized, " +
                "or we are fetching this serviceworker. Network fetching.");
    return fetch(event.request);
  }
  var url =  event.request.url;

  var readRequest = db.transaction(["requests"], "readonly")
                      .objectStore("requests")
                      .get(url);
  var readPromise = new Promise(function (resolve, reject) {
    readRequest.onsuccess = function(event) {
      if (!readRequest.result) {
        reject("Not in cache");
        return;
      }
      var reader = new FileReader();
      var blobPromise = new Promise(function (resolve, reject) {
        reader.onload = function(event) {
          console.log("Returning data from cache for url " + url);
          resolve(reader.result);
        }
        reader.onerror = function(event) {
          console.log(event);
          reject(event);
        }
      }).catch(function(error) {
        console.log("Error with reading blob");
        reject(error);
      });
      reader.readAsText(readRequest.result.response);
      resolve(blobPromise);
    };
    readRequest.onerror = function(event) {
      reject(event);
    };
  });

  var fetchPromise = fetch(event.request).then(function(response) {
      if (response.type == "error") {
        console.log("Network error!");
        console.log(response);
        return response;
      }
      // We clone the response because we need to consume it to get the
      // body contents.
      var responseCopy = response.clone();
      responseCopy.blob().then(function(blob) {
        if (blob.size == 0) {
          console.log('blob size is 0 for ' + url + ". Probably a cross-site " +
            "request, which we can't store in indexedDB. aborting.");
          return;
        }
        var addOperation = db.transaction(["requests"], "readwrite")
            .objectStore("requests")
            .put({request: url, response: blob, time: Date.now()});
        console.log("Storing url: " + url);
        addOperation.onsuccess = function(evt) {
          console.log('Stored successfully!');
        };
        addOperation.onerror = function(evt) {
          console.log("Store operation error!");
          console.log(evt);
        };
      }).catch(function(rej) {
        console.log("Error storing response");
        console.log(rej);
      });
      return response;
    });

  return raceSucceed([fetchPromise, readPromise]).catch(function(event) {
      console.log("Error.");
      console.log(event);
    })
});

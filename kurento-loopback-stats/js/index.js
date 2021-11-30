/*
 * (C) Copyright 2014-2015 Kurento (http://kurento.org/)
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 */

function getopts(args, opts) {
  var result = opts.default || {};
  args.replace(
    new RegExp("([^?=&]+)(=([^&]*))?", "g"),
    function($0, $1, $2, $3) {
      result[$1] = decodeURI($3);
    });

  return result;
};

var args = getopts(location.search, {
  default: {
    // Non-secure WebSocket
    // Only valid for localhost access! Browsers won't allow using this for
    // URLs that are not localhost. Also, this matches the default KMS config:
    ws_uri: "ws://" + location.hostname + ":8888/kurento",

    // Secure WebSocket
    // Valid for localhost and remote access. To use this, you have to edit the
    // KMS settings file "kurento.conf.json", and configure the section
    // "mediaServer.net.websocket.secure". Check the docs:
    // https://doc-kurento.readthedocs.io/en/latest/features/security.html#features-security-kms-wss
    //ws_uri: "wss://" + location.hostname + ":8433/kurento",

    ice_servers: undefined
  }
});

function setIceCandidateCallbacks(webRtcPeer, webRtcEp, onerror) {
  webRtcPeer.on('icecandidate', function(candidate) {
    console.log("Local candidate:", candidate.candidate);

    candidate = kurentoClient.getComplexType('IceCandidate')(candidate);

    webRtcEp.addIceCandidate(candidate, onerror)
  });

  webRtcEp.on('IceCandidateFound', function(event) {
    var candidate = event.candidate;

    console.log("Remote candidate:", candidate.candidate);

    webRtcPeer.addIceCandidate(candidate, onerror);
  });
}

var webRtcPeer;
var pipeline;
var webRtcEndpoint;
var json_dump = [];

window.addEventListener('load', function() {
  console = new Console();

  var videoInput = document.getElementById('videoInput');
  var videoOutput = document.getElementById('videoOutput');

  var startButton = document.getElementById("start");
  var stopButton = document.getElementById("stop");

  startButton.addEventListener("click", function() {
    showSpinner(videoInput, videoOutput);

    var options = {
      localVideo: videoInput,
      remoteVideo: videoOutput
    };

    if (args.ice_servers) {
      console.log("Use ICE servers: " + args.ice_servers);
      options.configuration = {
        iceServers : JSON.parse(args.ice_servers)
      };
    } else {
      console.log("Use freeice")
    }

    webRtcPeer = kurentoUtils.WebRtcPeer.WebRtcPeerSendrecv(options, function(error) {
      if (error) return onError(error)

      this.generateOffer(onOffer)
    });

    function onOffer(error, sdpOffer) {
      if (error) return onError(error)

      kurentoClient(args.ws_uri, function(error, kurentoClient) {
        if (error) return onError(error);

        kurentoClient.create("MediaPipeline", function(error, _pipeline) {
          if (error) return onError(error);

          pipeline = _pipeline;

          //Activate the ability to gather end-to-end latency stats
          pipeline.setLatencyStats(true, function(error){
            if (error) return onError(error);
          })

          pipeline.create("WebRtcEndpoint", function(error, webRtc) {
            if (error) return onError(error);

            webRtcEndpoint = webRtc;

            setIceCandidateCallbacks(webRtcPeer, webRtc, onError)

            webRtc.processOffer(sdpOffer, function(error, sdpAnswer) {
              if (error) return onError(error);

              webRtc.gatherCandidates(onError);

              webRtcPeer.processAnswer(sdpAnswer, onError);
            });

            webRtc.connect(webRtc, function(error) {
              if (error) return onError(error);

              console.log("Loopback established");

              webRtcEndpoint.on('MediaStateChanged', function(event) {
                if (event.newState == "CONNECTED") {
                  console.log("MediaState is CONNECTED ... printing stats...")
                  activateStatsTimeout();
                }
              });
            });
          });
        });
      });
    }
  });
  stopButton.addEventListener("click", stop);
});

function activateStatsTimeout() {
  setTimeout(function() {
    if (!webRtcPeer || !pipeline) return;

    var now = new Date();
    var time_data = { 
      'stats': printStats(),
      'timestamp': now.getTime()
    }
    json_dump.push(time_data)

    // printStats();
    activateStatsTimeout();
  }, 1000);
}

function printStats() {
  var stats = {};
  
  //listStats(webRtcPeer.peerConnection, webRtcEndpoint);
  
  stats['browser_send'] = getBrowserOutgoingVideoStats(webRtcPeer, function(error, stats) {
    if (error) return console.log("Warning: could not gather browser outgoing stats: " + error);
      
    document.getElementById('browserOutgoingSsrc').innerHTML = stats.ssrc;
    document.getElementById('browserPacketsSent').innerHTML = stats.packetsSent;
    document.getElementById('browserBytesSent').innerHTML = stats.bytesSent;
    // packetsLost
    // jitter
    document.getElementById('browserNackReceived').innerHTML = stats.nackCount;
    document.getElementById('browserFirReceived').innerHTML = stats.firCount;
    document.getElementById('browserPliReceived').innerHTML = stats.pliCount;
    document.getElementById('browserOutgoingIceRtt').innerHTML = stats.iceRoundTripTime;
    document.getElementById('browserOutgoingAvailableBitrate').innerHTML = stats.availableBitrate;
  });

  stats['kms_recv'] = getKMSIncomingStats(webRtcEndpoint, function(error, stats) {
    if (error) return console.log("Warning: could not gather WebRtcEndpoint input stats: " + error);
    if (!stats) return;

    document.getElementById('kmsIncomingSsrc').innerHTML = stats.ssrc;
    document.getElementById('kmsBytesReceived').innerHTML = stats.bytesReceived;
    document.getElementById('kmsPacketsReceived').innerHTML = stats.packetsReceived;
    document.getElementById('kmsPliSent').innerHTML = stats.pliCount;
    document.getElementById('kmsFirSent').innerHTML = stats.firCount;
    document.getElementById('kmsNackSent').innerHTML = stats.nackCount;
    document.getElementById('kmsJitter').innerHTML = stats.jitter;
    document.getElementById('kmsPacketsLost').innerHTML = stats.packetsLost;
    document.getElementById('kmsFractionLost').innerHTML = stats.fractionLost;
    document.getElementById('kmsRembSend').innerHTML = stats.remb;
  });

  stats['kms_send'] = getKMSOutgoingStats(webRtcEndpoint, function(error, stats){
    if (error) return console.log("Warning: could not gather WebRtcEndpoint output stats: " + error);
    if (!stats) return;

    document.getElementById('kmsOutogingSsrc').innerHTML = stats.ssrc;
    document.getElementById('kmsBytesSent').innerHTML = stats.bytesSent;
    document.getElementById('kmsPacketsSent').innerHTML = stats.packetsSent;
    document.getElementById('kmsPliReceived').innerHTML = stats.pliCount;
    document.getElementById('kmsFirReceived').innerHTML = stats.firCount;
    document.getElementById('kmsNackReceived').innerHTML = stats.nackCount;
    document.getElementById('kmsRtt').innerHTML = stats.roundTripTime;
    document.getElementById('kmsRembReceived').innerHTML = stats.remb;
  });
  
  stats['browser_recv'] = getBrowserIncomingVideoStats(webRtcPeer, function(error, stats) {
    if (error) return console.log("Warning: could not gather browser incoming stats: " + error);

    document.getElementById('browserIncomingSsrc').innerHTML = stats.ssrc;
    document.getElementById('browserPacketsReceived').innerHTML = stats.packetsReceived;
    document.getElementById('browserBytesReceived').innerHTML = stats.bytesReceived;
    document.getElementById('browserIncomingPacketsLost').innerHTML = stats.packetsLost;
    document.getElementById('browserIncomingJitter').innerHTML = stats.jitter;
    document.getElementById('browserNackSent').innerHTML = stats.nackCount;
    document.getElementById('browserFirSent').innerHTML = stats.firCount;
    document.getElementById('browserPliSent').innerHTML = stats.pliCount;
    document.getElementById('browserIncomingIceRtt').innerHTML = stats.iceRoundTripTime;
    document.getElementById('browserIncomingAvailableBitrate').innerHTML = stats.availableBitrate;
  });

  stats['latency'] = getEndpointStats(webRtcEndpoint, function(error, stats){
    if(error) return console.log("Warning: could not gather webRtcEndpoint endpoint stats: " + error);
    if(!stats) return;

    document.getElementById('e2eLatency').innerHTML = stats.videoE2ELatency / 1000000 + " milliseconds";

  });

  // Optional stats
  // stats['browser_send_audio'] = getBrowserOutgoingAudioStats(webRtcPeer, function(error, stats) {
  //   throw new Error("Not implemented");
  // });
  
  // stats['browser_recv_audio'] = getBrowserIncomingAudioStats(webRtcPeer, function(error, stats) {
  //   throw new Error("Not implemented");
  // });

  return stats;
}

function getBrowserOutgoingVideoStats(webRtcPeer, callback) {
  if (!webRtcPeer) return callback("Cannot get stats from null webRtcPeer");
  let peerConnection = webRtcPeer.peerConnection;
  if (!peerConnection) return callback("Cannot get stats from null peerConnection");
  let localVideoStream = peerConnection.getLocalStreams()[0];
  if (!localVideoStream) return callback("Non existent local stream: cannot read stats");
  let localVideoTrack = localVideoStream.getVideoTracks()[0];
  if (!localVideoTrack) return callback("Non existent local video track: cannot read stats");

  let rtrn = {};
  peerConnection
    .getStats(localVideoTrack)
    .then(function(stats) {
      let retVal = { isRemote: false };

      // "stats" is of type RTCStatsReport
      // https://www.w3.org/TR/webrtc/#rtcstatsreport-object
      // https://developer.mozilla.org/en-US/docs/Web/API/RTCStatsReport
      // which behaves like a Map
      // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Map
      const statsArr = Array.from(stats.values());

      // "report.type" is of type RTCStatsType
      // https://developer.mozilla.org/en-US/docs/Web/API/RTCStatsType
      const reportsRtp = statsArr.filter(report => {
        return report.type === "outbound-rtp";
      });
      const reportsCandidatePair = statsArr.filter(report => {
        return report.type === "candidate-pair";
      });
      const reportsCodec = statsArr.filter(report => {
        return report.type === "codec";
      });

      // Get the first RTP report to import its stats
      if (reportsRtp.length < 1) {
        console.warn("No RTP reports found in RTCStats");
        return;
      }
      const reportRtp = reportsRtp[0];

      console.log("---------- [browser out] ----------");
      console.log(reportRtp);
      // RTCStats
      // https://w3c.github.io/webrtc-stats/#dom-rtcstats
      retVal["timestamp"] = reportRtp.timestamp;

      // RTCRtpStreamStats
      // https://w3c.github.io/webrtc-stats/#dom-rtcrtpstreamstats
      retVal["ssrc"] = reportRtp.ssrc;

      // RTCSentRtpStreamStats
      // https://w3c.github.io/webrtc-stats/#dom-rtcsentrtpstreamstats
      retVal["packetsSent"] = reportRtp.packetsSent;
      retVal["bytesSent"] = reportRtp.bytesSent;

      // RTCOutboundRtpStreamStats
      // https://w3c.github.io/webrtc-stats/#dom-rtcoutboundrtpstreamstats
      retVal["nackCount"] = reportRtp.nackCount;
      retVal["firCount"] = "firCount" in reportRtp ? reportRtp.firCount : 0;
      retVal["pliCount"] = "pliCount" in reportRtp ? reportRtp.pliCount : 0;
      retVal["sliCount"] = "sliCount" in reportRtp ? reportRtp.sliCount : 0;

      //  RTCIceCandidatePairStats
      // https://w3c.github.io/webrtc-stats/#dom-rtcicecandidatepairstats
      const matchCandidatePairs = reportsCandidatePair.filter(pair => {
        return pair.transportId === reportRtp.transportId;
      });
      if (matchCandidatePairs.length > 0) {
        retVal["iceRoundTripTime"] = matchCandidatePairs[0].currentRoundTripTime;
        retVal["availableBitrate"] = matchCandidatePairs[0].availableOutgoingBitrate;
      }
      
      // data log
      rtrn['timestamp'] = retVal["timestamp"]
      rtrn['ssrc'] = retVal["ssrc"]
      rtrn['packets'] = retVal["packetsSent"]
      rtrn['bytes'] = retVal["bytesSent"]
      rtrn['nack'] = retVal["nackCount"]
      rtrn['fir'] = retVal["firCount"]
      rtrn['pli'] = retVal["pliCount"]
      rtrn['sli'] = retVal["sliCount"]
      rtrn['ice_rtt'] = retVal["iceRoundTripTime"]
      rtrn['remb'] = retVal["availableBitrate"]
      // rtrn = retVal;

      return callback(null, retVal);
    })
    .catch(function(err) {
      rtrn['error'] = err 
      return callback(err, null);
    });
  
  return rtrn;
}

function getBrowserIncomingVideoStats(webRtcPeer, callback) {
  if (!webRtcPeer) return callback("Cannot get stats from null webRtcPeer");
  var peerConnection = webRtcPeer.peerConnection;
  if (!peerConnection) return callback("Cannot get stats from null peerConnection");
  var remoteVideoStream = peerConnection.getRemoteStreams()[0];
  if (!remoteVideoStream) return callback("Non existent remote stream: cannot read stats")
  var remoteVideoTrack = remoteVideoStream.getVideoTracks()[0];
  if (!remoteVideoTrack) return callback("Non existent remote video track: cannot read stats");

  let rtrn = {};
  peerConnection
    .getStats(remoteVideoTrack)
    .then(function(stats) {
      let retVal = { isRemote: true };

      // "stats" is of type RTCStatsReport
      // https://www.w3.org/TR/webrtc/#rtcstatsreport-object
      // https://developer.mozilla.org/en-US/docs/Web/API/RTCStatsReport
      // which behaves like a Map
      // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Map
      const statsArr = Array.from(stats.values());

      // "report.type" is of type RTCStatsType
      // https://developer.mozilla.org/en-US/docs/Web/API/RTCStatsType
      const reportsRtp = statsArr.filter(report => {
        return report.type === "inbound-rtp";
      });
      const reportsCandidatePair = statsArr.filter(report => {
        return report.type === "candidate-pair";
      });
      const reportsCodec = statsArr.filter(report => {
        return report.type === "codec";
      });

      // Get the first RTP report to import its stats
      if (reportsRtp.length < 1) {
        console.warn("No RTP reports found in RTCStats");
        return;
      }
      const reportRtp = reportsRtp[0];

      console.log("---------- [browser in] ----------");
      console.log(reportRtp);
      // RTCStats
      // https://w3c.github.io/webrtc-stats/#dom-rtcstats
      retVal["timestamp"] = reportRtp.timestamp;

      // RTCRtpStreamStats
      // https://w3c.github.io/webrtc-stats/#dom-rtcrtpstreamstats
      retVal["ssrc"] = reportRtp.ssrc;

      // RTCReceivedRtpStreamStats
      // https://w3c.github.io/webrtc-stats/#dom-rtcreceivedrtpstreamstats
      retVal["packetsReceived"] = reportRtp.packetsReceived;
      retVal["packetsLost"] = reportRtp.packetsLost;
      retVal["jitter"] = reportRtp.jitter;

      // RTCInboundRtpStreamStats
      // https://w3c.github.io/webrtc-stats/#dom-rtcinboundrtpstreamstats
      retVal["bytesReceived"] = reportRtp.bytesReceived;
      retVal["nackCount"] = reportRtp.nackCount;
      retVal["firCount"] = "firCount" in reportRtp ? reportRtp.firCount : 0;
      retVal["pliCount"] = "pliCount" in reportRtp ? reportRtp.pliCount : 0;
      retVal["sliCount"] = "sliCount" in reportRtp ? reportRtp.sliCount : 0;

      //  RTCIceCandidatePairStats
      // https://w3c.github.io/webrtc-stats/#dom-rtcicecandidatepairstats
      const matchCandidatePairs = reportsCandidatePair.filter(pair => {
        return pair.transportId === reportRtp.transportId;
      });
      if (matchCandidatePairs.length > 0) {
        retVal["iceRoundTripTime"] = matchCandidatePairs[0].currentRoundTripTime;
        retVal["availableBitrate"] = matchCandidatePairs[0].availableIncomingBitrate;
      }
      
      // data log
      rtrn['timestamp'] = retVal["timestamp"]
      rtrn['ssrc'] = retVal["ssrc"]
      rtrn['packets'] = retVal["packetsReceived"]
      rtrn['bytes'] = retVal["bytesReceived"]
      rtrn['packetsLost'] = retVal["packetsLost"]
      rtrn['jitter'] = retVal["jitter"]
      rtrn['nack'] = retVal["nackCount"]
      rtrn['fir'] = retVal["firCount"]
      rtrn['pli'] = retVal["pliCount"]
      rtrn['sli'] = retVal["sliCount"]
      rtrn['ice_rtt'] = retVal["iceRoundTripTime"]
      rtrn['remb'] = retVal["availableBitrate"]
      // rtrn = retVal;

      return callback(null, retVal);
    })
    .catch(function(err) {
      rtrn['error'] = err
      return callback(err, null);
    });

  return rtrn;
}

/*
Parameters:

mediaElement: valid reference of a media element.

statsType: one of
  inboundrtp
  outboundrtp
  datachannel
  element
  endpoint

mediaType: one of
  AUDIO
  VIDEO
*/

// Legacy from master
function getMediaElementStats(mediaElement, statsType, mediaType, callback){
  if (!mediaElement) return callback('Cannot get stats from null Media Element');
  if(!statsType) return callback('Cannot get stats with undefined statsType')
  if(!mediaType) mediaType = 'VIDEO'; //By default, video
  mediaElement.getStats(mediaType, function(error, statsMap){
    if(error) return callback(error);
    for(var key in statsMap){
      if(!statsMap.hasOwnProperty(key)) continue; //do not dig in prototypes properties

      stats = statsMap[key];
      if(stats.type != statsType) continue; //look for the type we want

      return callback(null, stats)
    }
    return callback('Could not find ' +
                      statsType + ':' + mediaType +
                      ' stats in element ' + mediaElement.id);
  });
}

function getKMSIncomingStats(mediaElement, callback) {
  if (!mediaElement) return callback('Cannot get stats from null Media Element');

  let rtrn = {};

  mediaElement.getStats('AUDIO', function(error, statsMap){
    if(error) return callback(error);
    for(var key in statsMap){
      if(!statsMap.hasOwnProperty(key)) continue; //do not dig in prototypes properties

      stats = statsMap[key];
      if(stats.type != 'inboundrtp') continue; //look for the type we want

      // data log
      console.log("---------- [kms audio in] ----------");
      console.log(stats);
      rtrn['audio'] = stats;

      return callback(null, null);
    }
    return callback('Could not find inboundrtp:AUDIO stats in element ' + mediaElement.id);
  });

  mediaElement.getStats('VIDEO', function(error, statsMap){
    if(error) return callback(error);
    for(var key in statsMap){
      if(!statsMap.hasOwnProperty(key)) continue; //do not dig in prototypes properties

      stats = statsMap[key];
      if(stats.type != 'inboundrtp') continue; //look for the type we want

      // data log
      console.log("---------- [kms video in] ----------");
      console.log(stats);
      rtrn['video'] = stats;

      return callback(null, stats);
    }
    return callback('Could not find inboundrtp:VIDEO stats in element ' + mediaElement.id);
  });

  return rtrn;
}

function getKMSOutgoingStats(mediaElement, callback) {
  if (!mediaElement) return callback('Cannot get stats from null Media Element');

  let rtrn = {};

  mediaElement.getStats('AUDIO', function(error, statsMap){
    if(error) return callback(error);
    for(var key in statsMap){
      if(!statsMap.hasOwnProperty(key)) continue; //do not dig in prototypes properties

      stats = statsMap[key];
      if(stats.type != 'outboundrtp') continue; //look for the type we want

      // data log
      console.log("---------- [kms audio out] ----------");
      console.log(stats);
      rtrn['audio'] = stats;

      return callback(null, null);
    }
    return callback('Could not find outboundrtp:AUDIO stats in element ' + mediaElement.id);
  });

  mediaElement.getStats('VIDEO', function(error, statsMap){
    if(error) return callback(error);
    for(var key in statsMap){
      if(!statsMap.hasOwnProperty(key)) continue; //do not dig in prototypes properties

      stats = statsMap[key];
      if(stats.type != 'outboundrtp') continue; //look for the type we want

      // data log
      console.log("---------- [kms video out] ----------");
      console.log(stats);
      rtrn['video'] = stats;

      return callback(null, stats);
    }
    return callback('Could not find outboundrtp:VIDEO stats in element ' + mediaElement.id);
  });

  return rtrn;
}

function getEndpointStats(mediaElement, callback) {
  if (!mediaElement) return callback('Cannot get stats from null Media Element');

  let rtrn = {};

  mediaElement.getStats('AUDIO', function(error, statsMap){
    if(error) return callback(error);
    for(var key in statsMap){
      if(!statsMap.hasOwnProperty(key)) continue; //do not dig in prototypes properties

      stats = statsMap[key];
      if(stats.type != 'endpoint') continue; //look for the type we want

      // data log
      console.log("---------- [endpoint audio] ----------");
      console.log(stats);
      rtrn['audioTimestamp'] = stats["timestampMillis"]
      rtrn['inputAudioLatency'] = stats["inputAudioLatency"]
      rtrn['audioE2ELatency'] = stats["audioE2ELatency"]
      // rtrn['audio'] = stats;

      return callback(null, null);
    }
    return callback('Could not find endpoint:AUDIO stats in element ' + mediaElement.id);
  });

  mediaElement.getStats('VIDEO', function(error, statsMap){
    if(error) return callback(error);
    for(var key in statsMap){
      if(!statsMap.hasOwnProperty(key)) continue; //do not dig in prototypes properties

      stats = statsMap[key];
      if(stats.type != 'endpoint') continue; //look for the type we want

      // data log
      console.log("---------- [endpoint video] ----------");
      console.log(stats)
      rtrn['videoTimestamp'] = stats["timestampMillis"]
      rtrn['inputVideoLatency'] = stats["inputVideoLatency"]
      rtrn['videoE2ELatency'] = stats["videoE2ELatency"]
      // rtrn['video'] = stats;

      return callback(null, stats);
    }
    return callback('Could not find endpoint:VIDEO stats in element ' + mediaElement.id);
  });

  return rtrn;
}

//Aux function used for printing stats associated to a track.
function listStats(peerConnection, webRtcEndpoint) {
  console.log('Listing stats for peer connection');
  var localVideoTrack = peerConnection.getLocalStreams()[0].getVideoTracks()[0];
  var remoteVideoTrack = peerConnection.getRemoteStreams()[0].getVideoTracks()[0];

  // Does not work in Firefox
  peerConnection.getStats(function(stats) {
    var results = stats.result();

    for (var i = 0; i < results.length; i++) {
      console.log("Iterating i=" + i);
      var res = results[i];
      console.log("res.type=" + res.type);
      var names = res.names();

      for (var j = 0; j < names.length; j++) {
        var name = names[j];
        var stat = res.stat(name);
        console.log("For name " + name + " stat is " + stat);
      }
    }
  }, remoteVideoTrack);
}

function stop() {
  if (webRtcPeer) {
    webRtcPeer.dispose();
    webRtcPeer = null;
  }

  if (pipeline) {
    pipeline.release();
    pipeline = null;
  }

  hideSpinner(videoInput, videoOutput);

  dump();
}

function onError(error) {
  if (error) {
    console.error(error);
    stop();
  }
}

function showSpinner() {
  for (var i = 0; i < arguments.length; i++) {
    arguments[i].poster = 'img/transparent-1px.png';
    arguments[i].style.background = "center transparent url('img/spinner.gif') no-repeat";
  }
}

function hideSpinner() {
  for (var i = 0; i < arguments.length; i++) {
    arguments[i].src = '';
    arguments[i].poster = 'img/webrtc.png';
    arguments[i].style.background = '';
  }
}

function dump() {
  console.log(json_dump);
  if (json_dump.length === 0) return;
  
  // download the stats file
  let now = new Date();
  const blob = new Blob([JSON.stringify(json_dump, null, '  ')], {type: 'application/json'});
  const link = document.createElement('a');
  link.href = window.URL.createObjectURL(blob);
  link.download = 'webrtc_kurento_stats_' 
    + now.getFullYear()
    + now.getMonth()
    + now.getDay()
    + now.getHours()
    + now.getMinutes()
    + now.getSeconds()
    + '.json';
  link.click();
  
  // 直接fsはダメ、ダウンロードさせるようにすること
  // const fs = require('fs');
  // fs.writeFileSync('webrtc_statistics_' 
  //   + now.getFullYear() 
  //   + now.getMonth()
  //   + now.getDay()
  //   + now.getHours()
  //   + now.getMinutes()
  //   + now.getSeconds(),
  // JSON.stringify(json_dump));

  console.log("JSON data dumped");
}

/**
 * Lightbox utility (to display media pipeline image in a modal dialog)
 */
$(document).delegate('*[data-toggle="lightbox"]', 'click', function(event) {
  event.preventDefault();
  $(this).ekkoLightbox();
});

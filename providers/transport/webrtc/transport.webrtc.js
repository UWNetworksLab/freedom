/*
 * Peer 2 Peer transport provider.
 *
 */

var WebRTCTransportProvider = function(dispatchEvent) {
  this.dispatchEvent = dispatchEvent;
  this.name = null;
  this._setup = false;
  this.pc = freedom['core.peerconnection']();
  this.pc.on('onReceived', this.onData.bind(this));
  this.pc.on('onClose', this.onClose.bind(this));
  this.pc.on('onOpenDataChannel', this.onNewTag.bind(this));
  this._tags = [];
  // Entries in this dictionary map tags to chunks of messages. If
  // there is no entry for a tag in the dictionary, then we have not
  // received the first chunk of the next message.
  this._chunks = {};
  // Messages may be limited to a 16KB length
  // http://tools.ietf.org/html/draft-ietf-rtcweb-data-channel-07#section-6.6
  this._chunkSize = 15000;
  // The maximum amount of bytes we should allow to get queued up in
  // peerconnection, any more and we start queueing ourself.
  this._pcQueueLimit = 1024 * 250;
  // Javascript has trouble representing integers larger than 2^53 exactly
  this._maxMessageSize = Math.pow(2, 53);
};

WebRTCTransportProvider.stun_servers = [
  "stun:stun.l.google.com:19302",
  "stun:stun1.l.google.com:19302",
  "stun:stun2.l.google.com:19302",
  "stun:stun3.l.google.com:19302",
  "stun:stun4.l.google.com:19302"
];

// The argument |channelId| is a freedom communication channel id to use
// to open a peer connection. 
WebRTCTransportProvider.prototype.setup = function(name, channelId, continuation) {
  // console.log("TransportProvider.setup." + name);
  this.name = name;
  var promise = this.pc.setup(channelId, name, WebRTCTransportProvider.stun_servers);
  this._setup = true;
  promise.then(continuation);
};

WebRTCTransportProvider.prototype.send = function(tag, data, continuation) {
  // console.log("TransportProvider.send." + this.name);
  if(!this._setup) {
    throw new Error("send called before setup in WebRTCTransportProvider");
  }
  if (this._tags.indexOf(tag) >= 0) {
    var buffers = this._chunk(data);
    this._waitSend(tag, buffers).then(continuation);
  } else {
    this.pc.openDataChannel(tag).then(function(){
      this._tags.push(tag);
      this.send(tag, data, continuation);
    }.bind(this));
  }
};

WebRTCTransportProvider.prototype._chunk = function(data) {
  // The first 8 bytes of the first chunk of a message encodes the
  // number of bytes in the message.
  var dataView = new Uint8Array(data);
  var buffers = [];
  var size = data.byteLength;
  var lowerBound = 0; // exclusive range
  var upperBound;

  // lowerBound points to the byte after the last byte to be chunked
  // from the original data buffer.  It should be the case that
  // lowerBound < upperBound.
  // Buffer: [------------------------------------------------]
  //          ^              ^              ^  
  //          lB_0           uB_0/lB_1      uB_1/lB_2 ...    ^uB_n
  
  var sizeBuffer = this._sizeToBuffer(size);
  var firstBuffer = new Uint8Array(Math.min(this._chunkSize,
                                             size + sizeBuffer.byteLength));

  firstBuffer.set(sizeBuffer, 0);
  upperBound = Math.min(this._chunkSize - sizeBuffer.byteLength,
                        firstBuffer.byteLength);
  firstBuffer.set(dataView.subarray(0, upperBound), sizeBuffer.byteLength);
  buffers.push(firstBuffer.buffer);
  lowerBound = upperBound;

  while (lowerBound < size) {
    upperBound = lowerBound + this._chunkSize;
    buffers.push(data.slice(lowerBound, upperBound));
    lowerBound = upperBound;
  }

  return buffers;
};

WebRTCTransportProvider.prototype._waitSend = function(tag, buffers) {
  console.info("_waitSend called");
  var bufferBound = 0; // upper bound on the # of bytes buffered

  var sendBuffers = function() {
    var promises = [];
    while(bufferBound + this._chunkSize <= this._pcQueueLimit &&
          buffers.length > 0) {
      var nextBuffer = buffers.shift();
      promises.push(this.pc.send({"channelLabel": tag,
                                  "buffer": nextBuffer}));
      bufferBound += nextBuffer.byteLength;
    }

    var allSends = Promise.all(promises);
    if (buffers.length === 0) {
      return allSends;
    }
    return allSends.then(checkBufferedAmount);
  }.bind(this);

  var checkBufferedAmount = function() {
    return this.pc.getBufferedAmount(tag).then(function(bufferedAmount) {
      bufferBound = bufferedAmount;
      if (bufferedAmount + this._chunkSize > this._pcQueueLimit) {
        return new Promise(function(resolve) {
          setTimeout(function() {
            resolve(checkBufferedAmount());
          }, 100);
        });
      } else {
        return sendBuffers();
      }
    });
  }.bind(this);
  // Check first, in case there is data in the pc buffer from another message.
  return checkBufferedAmount();
};


WebRTCTransportProvider.prototype.close = function(continuation) {
  // TODO: Close data channels.
  this._tags = [];
  this.pc.close().then(continuation);
};

// Called when the peer-connection receives data, it then passes it here.
WebRTCTransportProvider.prototype.onData = function(msg) {
  // console.log("TransportProvider.prototype.message: Got Message:" + JSON.stringify(msg));
  if (msg.buffer) {
    this._handleData(msg.channelLabel, msg.buffer);
  } else if (msg.text) {
    console.error("Strings not supported.");
  } else if (msg.blob) {
    console.error("Blob is not supported.");
  } else {
    console.error('message called without a valid data field');
  }
};

WebRTCTransportProvider.prototype._handleData = function(tag, buffer) {
  var currentTag;
  if (tag in this._chunks) {
    currentTag = this._chunks[tag];
    currentTag.buffers.push(buffer);
    currentTag.currentByteCount += buffer.byteLength;
  } else {
    currentTag = {buffers: [],
                  currentByteCount: 0,
                  totalByteCount: 0};
    this._chunks[tag] = currentTag;
    var size = this._bufferToSize(buffer.slice(0, 8));
    if (size > this._maxMessageSize) {
      console.warn("Incomming message is larger than maximum message size, this may also ");
    }
    currentTag.totalByteCount = size;
    currentTag.buffers.push(buffer.slice(8));
    currentTag.currentByteCount += buffer.byteLength - 8;
  }

  if(currentTag.currentByteCount === currentTag.totalByteCount) {
    var returnBuffer = this._assembleBuffers(tag);
    this.dispatchEvent('onData', {
      "tag": tag, 
      "data": returnBuffer
    });
    delete this._chunks[tag];
  } else if(currentTag.currentByteCount > currentTag.totalByteCount) {
    console.warn("Received more bytes for message than expected, something has gone seriously wrong");
    delete this._chunks[tag];
  }
  
};

WebRTCTransportProvider.prototype.onNewTag = function(event) {
  this._tags.push(event.channelId);
};

WebRTCTransportProvider.prototype.onClose = function() {
  this._tags = [];
  this.dispatchEvent('onClose', null);
};


WebRTCTransportProvider.prototype._sizeToBuffer = function(size) {
  // Bit shifts have overflow issues for any integers with more than
  // 32 bits, so use division.
  var buffer = new ArrayBuffer(8);
  var view = new Uint8Array(buffer);
  for (var index = 0; index < 8; index++) {
    var currentByte = size & 0xff;
    view [ index ] = currentByte;
    size = (size - currentByte) / 256 ;
  }
  return view;
};

WebRTCTransportProvider.prototype._bufferToSize = function(buffer) {
  var view = new Uint8Array(buffer);
  var number = 0;
  for ( var i = view.byteLength - 1; i >= 0; i--) {
    number = (number * 256) + view[i];
  }

  return number;
};

/*
 * Reassemble the buffers for the given tag into a single ArrayBuffer object.
 * @param {String} 
 * @return {ArrayBuffer} Result of concatenating all buffers for tag
 */
WebRTCTransportProvider.prototype._assembleBuffers = function(tag) {
  var size = this._chunks[tag].totalByteCount;
  var bytesCopied = 0;
  var result = new ArrayBuffer(size);
  var view = new Uint8Array(result);
  this._chunks[tag].buffers.forEach(function(buffer) {

    view.set(new Uint8Array(buffer), bytesCopied);
    bytesCopied += buffer.byteLength;
  });
  return result;
};

/** REGISTER PROVIDER **/
if (typeof freedom !== 'undefined') {
  freedom.transport().provideAsynchronous(WebRTCTransportProvider);
}

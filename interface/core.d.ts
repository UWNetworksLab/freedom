// This is the Freedom "proxy" object.
interface FreedomChannelId {}
// This is used when the promise returns no data.
interface NoDataPromise { done() }

interface P2pData {
    // The label of the data channel on which to send the data
    channelLabel: string
    // The data to send. Only one of the bellow should be defined;
    // TODO: when typescript supports union types, use them.
    text?: string
    binary?: Blob
    buffer?: ArrayBuffer
}

interface FreedomSctpPeerConnection {
  setup(freedomChannelId : FreedomChannelId, peerName : string)
      : NoDataPromise
  send(p2pData : P2pData) : NoDataPromise
  onReceived(p2pData : P2pData)
  openDataChannel(channelLabel : string) : NoDataPromise
  closeDataChannel(channelLabel : string) : NoDataPromise
  onOpenDataChannel(channelLabel : string)
  onCloseDataChannel(channelLabel : string)
  close() : NoDataPromise
  onClose()
}

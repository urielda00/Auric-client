function selectAudioEngine({ useServer, createMock, createNative, createExpo }) {
  return useServer ? (createNative || createExpo)() : createMock();
}

module.exports = { selectAudioEngine };

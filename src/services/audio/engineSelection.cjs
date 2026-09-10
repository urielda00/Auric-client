function selectAudioEngine({ useServer, createMock, createExpo }) {
  return useServer ? createExpo() : createMock();
}

module.exports = { selectAudioEngine };

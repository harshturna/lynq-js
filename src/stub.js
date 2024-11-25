window.lynq = window.lynq || {
  track: function (name, properties) {
    (window.lynqQueue = window.lynqQueue || []).push({
      name,
      properties,
      eventId: crypto.randomUUID(),
    });
  },
};

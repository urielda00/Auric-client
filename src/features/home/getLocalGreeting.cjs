function getLocalGreeting(date = new Date(), name = "Uriel") {
  const hour = date.getHours();

  if (hour >= 5 && hour < 12) return `Good morning, ${name}.`;
  if (hour >= 12 && hour < 17) return `Good afternoon, ${name}.`;
  if (hour >= 17 && hour < 22) return `Good evening, ${name}.`;
  return `Good night, ${name}.`;
}

module.exports = { getLocalGreeting };

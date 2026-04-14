const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.json({ ok: true });
});

app.post("/auth/email/start", (req, res) => {
  res.json({ message: "email start ok" });
});

app.post("/auth/email/verify", (req, res) => {
  res.json({ message: "email verify ok" });
});

app.post("/auth/phone/start", (req, res) => {
  res.json({ message: "phone start ok" });
});

app.post("/auth/phone/verify", (req, res) => {
  res.json({ message: "phone verify ok" });
});

app.listen(3000, () => {
  console.log("Server running on http://localhost:3000");
});


import jwt from "jsonwebtoken";

const generateToken = (tokenInfo) => {
  if (tokenInfo.org_id === "public") {
    const token = jwt.sign({ ...tokenInfo }, process.env.PUBLIC_CHATBOT_TOKEN, { expiresIn: "48h" });
    return token;
  }
  const token = jwt.sign({ ...tokenInfo }, process.env.CHATBOTSECRETKEY, { expiresIn: "48h" });
  return token;
};

export { generateToken };

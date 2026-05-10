# Mitsuyoshi Trading SaaS Ecosystem

Professional trading dashboard and admin terminal for MT5 copy-trading systems.

## 🚀 Features
- **Cinematic Landing Page**: Premium design with GSAP animations and 3D effects.
- **Client Dashboard**: Real-time equity tracking, multi-account support, and trade ledger.
- **Master Admin Terminal**: Full oversight of all users with a remote "Kill Switch" for MT5 terminals.
- **Membership System**: Authenticated signup, login, and secure profile management.

## 🛠️ Setup Instructions
1. **Host the API**:
   - Deploy `api_server.js` on a VPS (Node.js required).
   - Run `npm install express cors body-parser`.
   - Start with `node api_server.js`.
2. **Configure the EA**:
   - Update `InpStatsURL` in `CopyTrade_Slave_Pro.mq5` with your server's IP/Domain.
3. **Admin Access**:
   - Default Master Key: `MITSU_ADMIN_2026`.

## 📁 Project Structure
- `/index.html`: Landing page.
- `/dashboard_app.html`: Client interface.
- `/admin.html`: Master control center.
- `/api_server.js`: Node.js backend.
- `/dashboard_logic.js`: Frontend synchronization logic.

---
*Developed by Mitsuyoshi Systems.*

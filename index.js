require("dotenv").config();
const express = require("express");
const cors = require("cors"); 
const connectDB = require("./db");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const csv = require("csv-parser");
const bcrypt = require("bcryptjs");
const port = 3001;
const fs = require("fs");
const { console } = require("inspector");
const axios = require("axios");

// Connect to MongoDB
connectDB();

const app = express();
app.use(express.json());

// Enable CORS
app.use(cors({
    origin: "*", // Allows requests from any origin
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"]
}));

const UserSchema = new mongoose.Schema({
    username: String,
    password: String, // Hashed password
});

// Fix OverwriteModelError by checking if model already exists
const User = mongoose.models.User || mongoose.model("User", UserSchema);

// Define Kit Schema
const kitSchema = new mongoose.Schema({
    serialNumber: String,
    batchNumber: String,
    status: { type: String, enum: ["available", "sold"], default: "available" },
    orderId: { type: String, default: "" },
    invoiceUrl: { type: String, default: "" },
    invoiceId: { type: String, default: "" }
});

const Kit = mongoose.models.Kit || mongoose.model("Kit", kitSchema);

const codSchema = new mongoose.Schema({
    orderId: String,
    orderNo: String,
    customerName: String,
    customerEmail: String,
    customerPhone: String,
    invoiceId: String,
    invoiceUrl: { type: String, default: "" }, 
    amount: { type: Number, default: 0 },
    status: { type: String, enum: ["Awating Confirmation", "Confirmed" , "Cancelled"], default: "Awating Confirmation" },
});

const COD = mongoose.models.COD || mongoose.model("COD", codSchema);

app.get("/", (req, res) => {
    res.send("Server is running!");
});
app.get("/kits", async (req, res) => {
    try {
        const kits = await Kit.find();
        res.status(200).json(kits);
    } catch (error) {
        console.error("Error fetching kits:", error);
        res.status(500).json({ message: "Server error while fetching kits" });
    }
});
app.get("/kits/available", async (req, res) => {
    try {
        const { quantity } = req.query;
        const kitsToFetch = (quantity ? parseInt(quantity) : 1) * 2; // Default to 1 kit if not specified
        const kits = await Kit.find({ status: "available" }).limit(kitsToFetch);
        
        if (kits.length < kitsToFetch) {
            return res.status(400).json({ error: "Not enough available kits" });
        }
        
        res.json(kits);
    } catch (error) {
        res.status(500).json({ error: "Error fetching available kits" });
    }
});

// POST request to update kits as sold
app.post("/kits/sell", async (req, res) => {
    const { orderId, invoiceUrl, invoiceId, quantity } = req.body;
    try {
        const kitsToSell = (quantity ? parseInt(quantity) : 1) * 2;
        const kits = await Kit.find({ status: "available" }).limit(kitsToSell);
        
        if (kits.length < kitsToSell) {
            return res.status(400).json({ error: "Not enough available kits" });
        }
        
        const updatePromises = kits.map(kit => 
            Kit.findByIdAndUpdate(kit._id, {
                status: "sold",
                orderId,
                invoiceUrl,
                invoiceId
            }, { new: true })
        );
        
        const updatedKits = await Promise.all(updatePromises);
        res.json(updatedKits);
    } catch (error) {
        res.status(500).json({ error: "Error updating kits" });
    }
});

// POST request to add dummy kits
app.post("/kits/addDummy", async (req, res) => {
    try {
        const dummyKits = [
            { serialNumber: "SN001", batchNumber: "B001", status: "available" },
            { serialNumber: "SN002", batchNumber: "B002", status: "available" },
            { serialNumber: "SN003", batchNumber: "B003", status: "available" },
            { serialNumber: "SN004", batchNumber: "B004", status: "available" }
        ];
        await Kit.insertMany(dummyKits);
        res.json({ message: "Dummy kits added successfully" });
    } catch (error) {
        res.status(500).json({ error: "Error inserting dummy kits" });
    }
});

// Multer setup for file uploads
const upload = multer({ dest: "/tmp/" });

// POST request to upload CSV file and insert data into MongoDB
app.post("/kits/upload", upload.single("file"), async (req, res) => {
    try {
        const filePath = req.file.path;
        const kits = [];

        fs.createReadStream(filePath)
            .pipe(csv())
            .on("data", (row) => {
                kits.push({
                    serialNumber: row.serialNumber,
                    batchNumber: row.batchNumber,
                    status: row.status || "available",
                    orderId: "",
                    invoiceUrl: "",
                    invoiceId: ""
                });
            })
            .on("end", async () => {
                await Kit.insertMany(kits);
                fs.unlinkSync(filePath); // Delete file after processing
                res.json({ message: "CSV data uploaded successfully" });
            });
    } catch (error) {
        res.status(500).json({ error: "Error processing CSV file" });
    }
});

app.post("/login", async (req, res) => {
    const { username, password } = req.body;

    try {
        const user = await User.findOne({ username });
        if (!user) {
            return res.status(400).json({ error: "Invalid credentials" });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(400).json({ error: "Invalid credentials" });
        }

        // Generate JWT Token
        const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: "1h" });

        res.json({ token });
    } catch (error) {
        console.error("Login Error:", error);
        res.status(500).json({ error: "Login error" });
    }
});


app.delete("/kits/:id", async (req, res) => {
    try {
        const kit = await Kit.findById(req.params.id);

        if (!kit) {
            return res.status(404).json({ message: "Kit not found" });
        }

        if (kit.status !== "available") {
            return res.status(400).json({ message: "Only available kits can be deleted" });
        }

        await Kit.findByIdAndDelete(req.params.id);
        res.json({ message: "Kit deleted successfully" });
    } catch (error) {
        res.status(500).json({ message: "Error deleting kit", error });
    }
});




app.post("/cod", async (req, res) => {
    const { 
        orderId, 
        orderNo, 
        customerName, 
        customerEmail, 
        customerPhone, 
        invoiceId, 
        invoiceUrl,
        amount
    } = req.body;

    try {
        // Create a new COD entry
        const codEntry = new COD({
            orderId,
            orderNo,
            customerName,
            customerEmail,
            customerPhone,
            invoiceId,
            invoiceUrl,
            amount,
            status:"Awating Confirmation"
        });

        // Save to database
        await codEntry.save();

        // Log the details to console
        const kits = await Kit.find({ orderId });

        // Respond with both the COD entry and related kits
        res.json({
            cod: codEntry,
            kits: kits
        });
    } catch (error) {
        console.error("Error processing COD request:", error);
        res.status(500).json({ error: "Error processing COD request" });
    }
});




app.post("/kits/delete-multiple", async (req, res) => {
    try {
        const { ids } = req.body;
        if (!Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ error: "Invalid request. Provide an array of IDs." });
        }
        await Kit.deleteMany({ _id: { $in: ids } });
        res.status(200).json({ message: "Selected kits deleted successfully" });
    } catch (error) {
        res.status(500).json({ error: "Error deleting selected kits" });
    }
});

app.put("/cod/confirm/:id", async (req, res) => {
    try {
        // Step 1: Update the COD order status in the database
        const codOrder = await COD.findById(req.params.id);
        if (!codOrder) {
            return res.status(404).json({ message: "COD order not found" });
        }
        codOrder.status = "Confirmed";
        await codOrder.save();

        // Step 2: Update invoice status in Zoho Books
        const zohoUrl = `https://www.zohoapis.in/books/v3/invoices/${codOrder.invoiceId}/status/sent?organization_id=60015239129`;
        await axios.post(zohoUrl, {}, {
            headers: {
                "Authorization": "Zoho-oauthtoken 1000.196094717c97f662439fc6bf7f126e98.3d56897dc6fc8be0be029081bd337d3c",
                "Content-Type": "application/json"
            }
        });

        // Step 3: Trigger QuickReply campaign event
        const quickReplyUrl = "https://app.quickreply.ai/api/campaign/8hMwWjsStEp2rtdde_camp/event";
        const quickReplyBody = {
            phone: codOrder.customerPhone,
            amount: codOrder.amount,
            invoice_url: codOrder.invoiceUrl,
            order_detail: "Curapod",
            customer_name: codOrder.customerName
        };
        await axios.post(quickReplyUrl, quickReplyBody, {
            headers: {
                "client-id": "mctJnMd3cCTBhpDfb_c",
                "secret-key": "x9CT6wHvJ2DEYAZ4w",
                "Content-Type": "application/json"
            }
        });

        // Send success response
        res.json({ 
            message: "COD order confirmed successfully, invoice updated in Zoho, and QuickReply campaign triggered", 
            codOrder 
        });
    } catch (error) {
        console.error("Error confirming COD order:", error);
        res.status(500).json({ error: "Error confirming COD order" });
    }
});

app.get("/cod", async (req, res) => {
    try {
        const codOrders = await COD.find();
        res.status(200).json(codOrders);
    } catch (error) {
        console.error("Error fetching COD orders:", error);
        res.status(500).json({ message: "Server error while fetching COD orders" });
    }
});

app.put("/cod/cancel/:id", async (req, res) => {
    try {
        const codOrder = await COD.findById(req.params.id);
        if (!codOrder) {
            return res.status(404).json({ message: "COD order not found" });
        }

        // Cancel the order on Shopify
        const shopifyResponse = await axios.post(
            `https://litemed.myshopify.com/admin/api/2024-04/orders/${codOrder.orderId}/cancel.json`,
            {
                reason: "customer",
                transactions: [{ kind: "void" }],
            },
            {
                headers: {
                    "X-Shopify-Access-Token": process.env.SHOPIFY_ACCESS_TOKEN,
                    "Content-Type": "application/json",
                },
            }
        );

        if (shopifyResponse.status === 200) {
            codOrder.status = "Cancelled";
            await codOrder.save();
            res.json({ message: "COD order cancelled successfully", codOrder });
        } else {
            res.status(shopifyResponse.status).json({ error: "Failed to cancel order on Shopify" });
        }
    } catch (error) {
        console.error("Error canceling order on Shopify:", error.response?.data || error.message);
        res.status(500).json({ error: "Error canceling COD order" });
    }
});

app.listen(port, () => console.log(`Server running on port ${port}`));

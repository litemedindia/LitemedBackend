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
const { type } = require("os");

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
    serialNumbers: { 
        type: [String], 
        required: true 
    },
    batchNumbers: { 
        type: [String], 
        required: true 
    }, // Changed from batchNumber to batchNumbers
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


const returnServiceSchema = new mongoose.Schema({
    orderId: String,
    customerName: String,
    customerEmail: String,
    customerPhone: String,
    ticketType: { type: String, enum: ["Refund", "Replacement"] },
    status: { 
      type: String, 
      enum: ["Awaiting Return", "Return Received", "Refund Initiated"], 
      default: "Awaiting Return" 
    }
});

const ReturnService = mongoose.models.ReturnService || mongoose.model("ReturnService", returnServiceSchema);

app.get("/", (req, res) => {
    res.send("Server is running!");
});
app.get("/kits", async (req, res) => {
    try {
        const kits = await Kit.find();
        const formattedKits = kits.map(kit => ({
            ...kit.toObject(),
            serialNumbers: kit.serialNumbers.join(" & "),
            batchNumbers: kit.batchNumbers.join(" & ")
        }));
        res.status(200).json(formattedKits);
    } catch (error) {
        console.error("Error fetching kits:", error);
        res.status(500).json({ message: "Server error while fetching kits" });
    }
});

app.get("/kits/available", async (req, res) => {
    try {
        const { quantity } = req.query;
        const kitsToFetch = quantity ? parseInt(quantity) : 1;
        const kits = await Kit.find({ status: "available" }).limit(kitsToFetch);
        
        if (kits.length < kitsToFetch) {
            return res.status(400).json({ error: "Not enough available kits" });
        }
        
        const combinedKit = {
            serialNumbers: kits.flatMap(kit => kit.serialNumbers).join("&"),
            batchNumbers: [
                ...new Set(
                    kits.map(kit => 
                        kit.batchNumbers && kit.batchNumbers.length > 0 
                            ? kit.batchNumbers[0] 
                            : kit.batchNumber || "Unknown"
                    ).filter(Boolean)
                )
            ].join("&"),
            status: "available"
        };
        
        res.json(combinedKit);
    } catch (error) {
        res.status(500).json({ error: "Error fetching available kits" });
    }
});
// POST request to update kits as sold
app.post("/kits/sell", async (req, res) => {
    const { orderId, invoiceUrl, invoiceId, quantity } = req.body;
    try {
        const kitsToSell = quantity ? parseInt(quantity) : 1;
        const totalSerialNumbersNeeded = kitsToSell * 2;
        const availableKits = await Kit.find({ status: "available" })
            .sort({ "serialNumbers.0": 1 })
            .limit(kitsToSell);

        if (availableKits.length < kitsToSell) {
            return res.status(400).json({ error: "Not enough available kits" });
        }

        const serialNumbersToSell = availableKits.flatMap(kit => kit.serialNumbers);
        const batchNumbersToSell = availableKits
            .map(kit => kit.batchNumbers && kit.batchNumbers.length > 0 ? kit.batchNumbers[0] : kit.batchNumber || "Unknown")
            .filter(Boolean);

        let existingKit = await Kit.findOne({ orderId });
        if (existingKit) {
            existingKit.serialNumbers = [...existingKit.serialNumbers, ...serialNumbersToSell];
            existingKit.batchNumbers = [...new Set([...existingKit.batchNumbers, ...batchNumbersToSell])];
            existingKit.status = "sold";
            existingKit.invoiceUrl = invoiceUrl;
            existingKit.invoiceId = invoiceId;
            await existingKit.save();
            res.json({
                ...existingKit.toObject(),
                serialNumbers: existingKit.serialNumbers.join(" & "),
                batchNumbers: existingKit.batchNumbers.join(" & ")
            });
        } else {
            const newKit = new Kit({
                serialNumbers: serialNumbersToSell,
                batchNumbers: batchNumbersToSell,
                status: "sold",
                orderId,
                invoiceUrl,
                invoiceId
            });
            await newKit.save();
            res.json({
                ...newKit.toObject(),
                serialNumbers: newKit.serialNumbers.join(" & "),
                batchNumbers: newKit.batchNumbers.join(" & ")
            });
        }

        const kitIdsToDelete = availableKits.map(kit => kit._id);
        await Kit.deleteMany({ _id: { $in: kitIdsToDelete } });
    } catch (error) {
        res.status(500).json({ error: "Error updating kits" });
    }
});

// POST request to add dummy kits
app.post("/kits/addDummy", async (req, res) => {
    try {
        const dummyKits = [
            { serialNumbers: ["SN009", "SN010"], batchNumbers: ["B004"], status: "available" },
            { serialNumbers: ["SN011", "SN012"], batchNumbers: ["B004"], status: "available" },
            { serialNumbers: ["SN013", "SN014"], batchNumbers: ["B004"], status: "available" },
            { serialNumbers: ["SN015", "SN016"], batchNumbers: ["B004"], status: "available" }
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
                    serialNumbers: [row.serialNumber1, row.serialNumber2],
                    batchNumbers: [row.batchNumber], // Array with one batch
                    status: row.status || "available",
                    orderId: "",
                    invoiceUrl: "",
                    invoiceId: ""
                });
            })
            .on("end", async () => {
                await Kit.insertMany(kits);
                fs.unlinkSync(filePath);
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
        const codOrder = await COD.findById(req.params.id);
        console.log(codOrder);
        if (!codOrder) {
            return res.status(404).json({ message: "COD order not found" });
        }
        codOrder.status = "Confirmed";
        await codOrder.save();

        // Step 2: Send data to the ActivePieces webhook
        const webhookUrl = "https://cloud.activepieces.com/api/v1/webhooks/682LiAIPHY4o1YSzvsPKs";
        const webhookBody = {
            orderId: codOrder.orderId,
            orderNo: codOrder.orderNo,
            customerName: codOrder.customerName,
            customerEmail: codOrder.customerEmail,
            customerPhone: codOrder.customerPhone,
            invoiceId: codOrder.invoiceId,
            invoiceUrl: codOrder.invoiceUrl,
            amount: codOrder.amount,
            status: codOrder.status
        };
        await axios.post(webhookUrl, webhookBody, {
            headers: {
                "Content-Type": "application/json"
            }
        });

        // Send success response
        res.json({ 
            message: "COD order confirmed successfully and webhook triggered", 
            codOrder 
        });
    } catch (error) {
        console.log("Error confirming COD order:", error);
        res.status(500).json(error);
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
        // First, find and mark the order as cancelled in the database
        const codOrder = await COD.findById(req.params.id);
        if (!codOrder) {
            return res.status(404).json({ message: "COD order not found" });
        }

        // Mark as cancelled in local database first
        codOrder.status = "Cancelled";
        await codOrder.save();

        // Then cancel the order on Shopify
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

        // If Shopify cancellation is successful, trigger the webhook
        if (shopifyResponse.status === 200) {
            const webhookUrl = "https://cloud.activepieces.com/api/v1/webhooks/682LiAIPHY4o1YSzvsPKs";
            const webhookBody = {
                orderId: codOrder.orderId,
                orderNo: codOrder.orderNo,
                customerName: codOrder.customerName,
                customerEmail: codOrder.customerEmail,
                customerPhone: codOrder.customerPhone,
                invoiceId: codOrder.invoiceId,
                invoiceUrl: codOrder.invoiceUrl,
                amount: codOrder.amount,
                status: codOrder.status
            };

            await axios.post(webhookUrl, webhookBody, {
                headers: {
                    "Content-Type": "application/json"
                }
            });

            res.json({ message: "COD order cancelled successfully", codOrder });
        } else {
            // If Shopify cancellation fails, you might want to revert the status
            codOrder.status = "Pending"; // or whatever the previous status was
            await codOrder.save();
            res.status(shopifyResponse.status).json({ error: "Failed to cancel order on Shopify" });
        }
    } catch (error) {
        console.error("Error canceling order:", error.response?.data || error.message);
        res.status(500).json({ error: "Error canceling COD order" });
    }
});

app.post("/kits/make-available", async (req, res) => {
    try {
        const { ids } = req.body;
        if (!Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ error: "Invalid request. Provide an array of IDs." });
        }
        const soldKits = await Kit.find({ _id: { $in: ids }, status: "sold" });
        if (soldKits.length !== ids.length) {
            return res.status(400).json({ error: "Some kits are not sold or do not exist." });
        }
        const newAvailableKits = [];
        for (const soldKit of soldKits) {
            const serialNumbers = soldKit.serialNumbers;
            const batchNumber = soldKit.batchNumbers[0] || "Unknown";
            for (let i = 0; i < serialNumbers.length; i += 2) {
                const pair = serialNumbers.slice(i, i + 2);
                const newKit = new Kit({
                    serialNumbers: pair,
                    batchNumbers: [batchNumber],
                    status: "available",
                    orderId: "",
                    invoiceUrl: "",
                    invoiceId: ""
                });
                newAvailableKits.push(newKit);
            }
        }
        await Kit.insertMany(newAvailableKits);
        await Kit.deleteMany({ _id: { $in: ids } });
        res.status(200).json({ message: "Kits made available successfully", newKits: newAvailableKits });
    } catch (error) {
        console.error("Error making kits available:", error);
        res.status(500).json({ error: "Error making kits available" });
    }
});

app.post("/returnservice", async (req, res) => {
    const { orderId, customerName, customerEmail, customerPhone, ticketType } = req.body;
    
    if (!orderId || !customerName || !customerEmail || !customerPhone || !ticketType) {
        return res.status(400).json({ error: "Missing required fields" });
    }
    
    if (!["Refund", "Replacement"].includes(ticketType)) {
        return res.status(400).json({ error: "Invalid ticket type" });
    }
    
    const newTicket = new ReturnService({
        orderId,
        customerName,
        customerEmail,
        customerPhone,
        ticketType,
        status: "Awaiting Return"
    });
    
    try {
        await newTicket.save();
        res.status(201).json(newTicket);
    } catch (error) {
        console.error("Error creating return service ticket:", error);
        res.status(500).json({ error: "Error creating ticket" });
    }
});

app.get("/returnservice", async (req, res) => {
    try {
        const tickets = await ReturnService.find();
        res.status(200).json(tickets);
    } catch (error) {
        console.error("Error fetching return service tickets:", error);
        res.status(500).json({ message: "Server error while fetching return service tickets" });
    }
});

app.get("/returnservice/:id", async (req, res) => {
    try {
        const ticket = await ReturnService.findById(req.params.id);
        if (!ticket) {
            return res.status(404).json({ error: "Ticket not found" });
        }
        res.json(ticket);
    } catch (error) {
        console.error("Error fetching return service ticket:", error);
        res.status(500).json({ error: "Error fetching ticket" });
    }
});

app.put("/returnservice/:id/action", async (req, res) => {
    const { action } = req.body;
    if (!action) {
        return res.status(400).json({ error: "Action is required" });
    }
    
    try {
        const ticket = await ReturnService.findById(req.params.id);
        if (!ticket) {
            return res.status(404).json({ error: "Ticket not found" });
        }
        
        if (action === "return_received" && ticket.status === "Awaiting Return") {
            ticket.status = "Return Received";
        } else if (action === "refund_initiated" && ticket.status === "Return Received" && ticket.ticketType === "Refund") {
            ticket.status = "Refund Initiated";
        } else {
            return res.status(400).json({ error: "Invalid action for current status and ticket type" });
        }
        
        await ticket.save();
        res.json(ticket);
    } catch (error) {
        console.error("Error updating return service ticket:", error);
        res.status(500).json({ error: "Error updating ticket" });
    }
});

app.listen(port, () => console.log(`Server running on port ${port}`));

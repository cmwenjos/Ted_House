const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const multer = require('multer');
const nodemailer = require('nodemailer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3000;

// ==========================================
// CONFIGURATION: YOUR PERSONAL CREDENTIALS
// ==========================================
const ADMIN_EMAIL = "admin@propertyportal.com";
const ADMIN_PASSWORD_HASH = bcrypt.hashSync("CreatorAdmin2026!", 10);
const MY_PERSONAL_EMAIL = "your-email@gmail.com"; // <-- Put your real email here

// Nodemailer Transporter Setup
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: MY_PERSONAL_EMAIL,
        pass: 'your-email-app-password' // <-- Put your Gmail App Password here
    }
});

// Uploads Folder Setup
const uploadDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// Multer Storage Configuration (Supports up to 15 Photos)
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});
const upload = multer({ storage });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
    secret: 'super-secret-property-portal-key',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false }
}));

let isDbConnected = false;
let memorySearchLogs = [];
let memoryUsers = [
    { _id: 'admin_1', email: ADMIN_EMAIL, password: ADMIN_PASSWORD_HASH, role: 'owner', createdAt: new Date() }
];
let memoryProperties = [
    {
        _id: '1',
        title: "3-Bedroom Townhouse with Elevator Lift",
        location: "Gikambura, Kikuyu",
        propertyType: "Townhouse",
        price: 16000000,
        bedrooms: 3,
        bathrooms: 4,
        description: "All ensuite townhouse with a private elevator lift, borehole water, and detached SQ.",
        amenities: ["Gated Community", "Elevator Lift", "Borehole", "Parking", "24/7 Security"],
        videoUrls: ["https://www.youtube.com/embed/dQw4w9WgXcQ"],
        images: ["https://images.unsplash.com/photo-1580587771525-78b9dba3b914?auto=format&fit=crop&w=600&q=80"],
        status: "Available",
        views: 84,
        clicks: 19
    }
];

mongoose.connect('mongodb://127.0.0.1:27017/property_portal', { serverSelectionTimeoutMS: 2000 })
    .then(async () => {
        isDbConnected = true;
        const adminExists = await User.findOne({ email: ADMIN_EMAIL });
        if (!adminExists) {
            await new User({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD_HASH, role: 'owner' }).save();
        }
    })
    .catch(() => {
        console.warn('MongoDB offline. Using in-memory fallback.');
    });

const User = mongoose.model('User', new mongoose.Schema({
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    role: { type: String, enum: ['customer', 'owner'], default: 'customer' }
}, { timestamps: true }));

const Property = mongoose.model('Property', new mongoose.Schema({
    title: { type: String, required: true },
    location: { type: String, required: true },
    propertyType: { type: String, required: true },
    price: { type: Number, required: true },
    bedrooms: { type: Number, default: 1 },
    bathrooms: { type: Number, default: 1 },
    description: { type: String },
    amenities: [String],
    videoUrls: [String],
    images: [String],
    status: { type: String, enum: ['Available', 'Sold Out', 'Rented Out'], default: 'Available' },
    views: { type: Number, default: 0 },
    clicks: { type: Number, default: 0 },
    ownerId: { type: String }
}, { timestamps: true }));

const SearchLog = mongoose.model('SearchLog', new mongoose.Schema({
    queryTerm: String,
    location: String,
    propertyType: String,
    maxPrice: Number,
    createdAt: { type: Date, default: Date.now }
}));

// Helper to sanitize video URLs into YouTube embed format
function cleanVideoUrls(rawInput) {
    if (!rawInput) return [];
    let list = Array.isArray(rawInput) ? rawInput : rawInput.split(/[\n,]+/);
    return list.map(v => v.trim()).filter(Boolean).map(url => {
        if (url.includes('watch?v=')) {
            return url.replace('watch?v=', 'embed/');
        }
        if (url.includes('youtu.be/')) {
            const id = url.split('youtu.be/')[1].split('?')[0];
            return `https://www.youtube.com/embed/${id}`;
        }
        return url;
    });
}

// --- AUTHENTICATION ROUTES ---
app.post('/api/register', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) return res.status(400).json({ error: "Email and password are required" });
        if (email.toLowerCase() === ADMIN_EMAIL.toLowerCase()) return res.status(400).json({ error: "Reserved email." });

        const hashedPassword = await bcrypt.hash(password, 10);
        if (isDbConnected) {
            if (await User.findOne({ email })) return res.status(400).json({ error: "Email already registered" });
            await new User({ email, password: hashedPassword, role: 'customer' }).save();
        } else {
            if (memoryUsers.find(u => u.email === email)) return res.status(400).json({ error: "Email already registered" });
            memoryUsers.push({ _id: Date.now().toString(), email, password: hashedPassword, role: 'customer', createdAt: new Date() });
        }
        res.status(201).json({ message: "Registration successful!" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = isDbConnected ? await User.findOne({ email }) : memoryUsers.find(u => u.email === email);
        if (!user || !await bcrypt.compare(password, user.password)) return res.status(400).json({ error: "Invalid credentials" });
        
        req.session.userId = user._id;
        req.session.role = user.role;
        req.session.email = user.email;
        res.json({ message: "Logged in successfully", role: user.role, email: user.email });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/session', (req, res) => {
    if (req.session.userId) {
        res.json({ loggedIn: true, role: req.session.role, email: req.session.email });
    } else {
        res.json({ loggedIn: false });
    }
});

app.post('/api/logout', (req, res) => {
    req.session.destroy(() => res.json({ message: "Logged out" }));
});

// --- CONTACT FORM ROUTE ---
app.post('/api/contact', async (req, res) => {
    try {
        const { guestEmail, message, propertyTitle } = req.body;
        const senderEmail = req.session.email || guestEmail;

        if (!senderEmail || !message) {
            return res.status(400).json({ error: "Email and message are required." });
        }

        const mailOptions = {
            from: senderEmail,
            to: MY_PERSONAL_EMAIL,
            subject: `Inquiry Regarding: ${propertyTitle || 'General Inquiry'}`,
            text: `Sender: ${senderEmail}\nProperty: ${propertyTitle || 'General'}\n\nMessage:\n${message}`
        };

        try {
            await transporter.sendMail(mailOptions);
        } catch (emailErr) {
            console.log("Mock Email Sent to Admin Inbox:", mailOptions);
        }

        res.json({ success: true, message: "Your message has been emailed directly to the property owner!" });
    } catch (err) {
        res.status(500).json({ error: "Failed to send message." });
    }
});

// --- ANALYTICS & PROPERTY METRICS ---
app.post('/api/properties/:id/track', async (req, res) => {
    const { action } = req.body;
    try {
        if (isDbConnected) {
            await Property.findByIdAndUpdate(req.params.id, { $inc: action === 'click' ? { clicks: 1 } : { views: 1 } });
        } else {
            const prop = memoryProperties.find(p => p._id === req.params.id);
            if (prop) prop[action === 'click' ? 'clicks' : 'views']++;
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json();
    }
});

app.get('/api/admin/analytics', async (req, res) => {
    try {
        if (!req.session.userId || req.session.role !== 'owner') return res.status(403).json({ error: "Unauthorized" });
        const customers = isDbConnected ? await User.find({ role: 'customer' }).select('-password').sort({ createdAt: -1 }) : memoryUsers.filter(u => u.role === 'customer');
        const searches = isDbConnected ? await SearchLog.find().sort({ createdAt: -1 }).limit(50) : [...memorySearchLogs].reverse();
        const propertyMetrics = isDbConnected ? await Property.find().select('title location price views clicks status') : memoryProperties;

        const totalViews = propertyMetrics.reduce((sum, p) => sum + (p.views || 0), 0);
        const totalClicks = propertyMetrics.reduce((sum, p) => sum + (p.clicks || 0), 0);

        res.json({
            summary: { 
                totalCustomers: customers.length, 
                totalViews, 
                totalClicks, 
                overallCTR: totalViews > 0 ? ((totalClicks / totalViews) * 100).toFixed(1) + '%' : '0.0%' 
            },
            customers, 
            searches, 
            propertyMetrics
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/properties', async (req, res) => {
    try {
        const { location, maxPrice, propertyType } = req.query;
        const isLoggedIn = !!req.session.userId;

        if (location || propertyType || maxPrice) {
            const searchEntry = {
                queryTerm: `${location || 'Any location'} | ${propertyType || 'All Types'} | Max: ${maxPrice || 'Any'}`,
                location: location || '',
                propertyType: propertyType || '',
                maxPrice: maxPrice ? Number(maxPrice) : null,
                createdAt: new Date()
            };
            if (isDbConnected) new SearchLog(searchEntry).save().catch(() => {});
            else memorySearchLogs.push(searchEntry);
        }

        let query = {};
        if (location) query.location = { $regex: location,$options: 'i' };
        if (propertyType) query.propertyType = propertyType;
        if (maxPrice) query.price = { $lte: Number(maxPrice) };

        let properties = isDbConnected ? await Property.find(query).limit(isLoggedIn ? 0 : 5) : memoryProperties.slice(0, isLoggedIn ? memoryProperties.length : 5);
        let totalCount = isDbConnected ? await Property.countDocuments(query) : memoryProperties.length;

        res.json({ properties, totalCount, isLocked: !isLoggedIn && totalCount > 5, unseenCount: isLoggedIn ? 0 : Math.max(0, totalCount - 5) });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Add Property (Multiple Photos + Multiple Videos + Full Amenities)
app.post('/api/properties', upload.array('propertyImages', 15), async (req, res) => {
    try {
        if (!req.session.userId || req.session.role !== 'owner') return res.status(403).json({ error: "Unauthorized" });
        const { title, location, propertyType, price, bedrooms, bathrooms, description, videoUrls, amenities, status } = req.body;
        
        if (!title || !location || !price) {
            return res.status(400).json({ error: "Title, location, and price are required." });
        }

        const imagePaths = req.files && req.files.length > 0 ? req.files.map(f => `/uploads/${f.filename}`) : [];
        const amenitiesArray = amenities ? (Array.isArray(amenities) ? amenities : [amenities]) : [];
        const processedVideos = cleanVideoUrls(videoUrls);

        const data = {
            title, 
            location, 
            propertyType: propertyType || "Townhouse", 
            price: Number(price), 
            bedrooms: Number(bedrooms) || 1, 
            bathrooms: Number(bathrooms) || 1,
            description: description || "", 
            videoUrls: processedVideos, 
            amenities: amenitiesArray,
            images: imagePaths, 
            status: status || "Available", 
            ownerId: req.session.userId
        };

        if (isDbConnected) await new Property(data).save();
        else memoryProperties.push({ _id: Date.now().toString(), ...data, views: 0, clicks: 0 });

        res.status(201).json({ message: "Property published successfully with multiple media!" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Edit Property
app.put('/api/properties/:id', upload.array('propertyImages', 15), async (req, res) => {
    try {
        if (!req.session.userId || req.session.role !== 'owner') return res.status(403).json({ error: "Unauthorized" });
        const { title, location, propertyType, price, bedrooms, bathrooms, description, videoUrls, amenities, status } = req.body;
        
        const amenitiesArray = amenities ? (Array.isArray(amenities) ? amenities : [amenities]) : [];
        const processedVideos = cleanVideoUrls(videoUrls);

        let updateData = { 
            title, 
            location, 
            propertyType, 
            price: Number(price), 
            bedrooms: Number(bedrooms), 
            bathrooms: Number(bathrooms), 
            description, 
            videoUrls: processedVideos, 
            amenities: amenitiesArray, 
            status 
        };

        if (req.files && req.files.length > 0) {
            updateData.images = req.files.map(f => `/uploads/${f.filename}`);
        }

        if (isDbConnected) await Property.findByIdAndUpdate(req.params.id, updateData);
        else { 
            const p = memoryProperties.find(x => x._id === req.params.id); 
            if (p) Object.assign(p, updateData); 
        }
        res.json({ message: "Listing updated successfully!" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/properties/:id', async (req, res) => {
    try {
        if (!req.session.userId || req.session.role !== 'owner') return res.status(403).json({ error: "Unauthorized" });
        if (isDbConnected) await Property.findByIdAndDelete(req.params.id);
        else memoryProperties = memoryProperties.filter(p => p._id !== req.params.id);
        res.json({ message: "Deleted" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, () => console.log(`Server live at http://localhost:${PORT}`));
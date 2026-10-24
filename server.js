Process.on('uncaughtException', (err) => {
    console.error('Kritik Sistem Xətası (Uncaught Exception):', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('İdarə olunmayan Promise Xətası (Unhandled Rejection):', reason);
});

require('dotenv').config();
const express = require('express');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// Yaddaşda (Memory) saxlamaq üçün multer konfiqurasiyası (Railway diski sıfırlamasın deyə Base64-ə çevriləcək)
const upload = multer({ 
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

app.use(helmet({ contentSecurityPolicy: false }));

const adminLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, 
    max: 20,
    message: { success: false, message: "Çoxlu yanlış cəhd! 15 dəqiqə sonra yenidən sınayın." }
});

const apiLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, 
    max: 150,
    message: { success: false, message: "Çox sürətli sorğu göndərirsiniz, zəhmət olmasa bir az gözləyin." }
});

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/sekil', express.static(path.join(__dirname, 'sekil')));

app.use('/api/', apiLimiter);

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'sayt.html'));
});

app.post('/api/news/test-auth', adminLimiter, (req, res) => {
    const { password } = req.body;
    const currentEnvPassword = process.env.ADMIN_PASSWORD;

    if (!currentEnvPassword || password !== currentEnvPassword) {
        return res.status(403).json({ success: false, message: "Şifrə səhvdir!" });
    }
    return res.json({ success: true, message: "Şifrə doğrudur!" });
});

app.get('/api/news', async (req, res) => {
    try {
        const now = Date.now();
        const THREE_DAYS = 3 * 24 * 60 * 60 * 1000; 
        const ONE_WEEK = 7 * 24 * 60 * 60 * 1000;   

        const newsExpireTime = now - THREE_DAYS;
        const statsExpireTime = now - ONE_WEEK;

        // Köhnə xəbərləri sil
        await supabase
            .from('news')
            .delete()
            .neq('category', 'SYSTEM_VISITS')
            .lt('createdAt', newsExpireTime);

        await supabase
            .from('news')
            .delete()
            .eq('category', 'SYSTEM_VISITS')
            .lt('createdAt', statsExpireTime);

        const { data, error } = await supabase
            .from('news')
            .select('*')
            .order('createdAt', { ascending: false });

        if (error) throw error;

        res.json(data || []);
    } catch (err) {
        console.error("Məlumatları oxumaq və təmizləmək xətası:", err);
        res.status(500).json({ success: false, message: "Server xətası" });
    }
});

app.post('/api/news', adminLimiter, upload.fields([
    { name: 'sekil', maxCount: 1 },
    { name: 'newsVideoFile', maxCount: 1 }
]), async (req, res) => {
    const { title, content, category, password, date, createdAt, videoUrl } = req.body;
    const currentEnvPassword = process.env.ADMIN_PASSWORD;

    if (!currentEnvPassword || password !== currentEnvPassword) {
        return res.status(403).json({ success: false, message: "Admin şifrəsi yanlışdır!" });
    }

    if (!title || !content) {
        return res.status(400).json({ success: false, message: "Başlıq və mətn mütləqdir!" });
    }

    try {
        const cat = category && category.trim() !== "" ? category : "Maraqlı";
        
        let sekilData = "";
        if (req.files && req.files['sekil'] && req.files['sekil'][0]) {
            const file = req.files['sekil'][0];
            const b64 = Buffer.from(file.buffer).toString('base64');
            sekilData = `data:${file.mimetype};base64,${b64}`;
        }

        let videoFileData = "";
        if (req.files && req.files['newsVideoFile'] && req.files['newsVideoFile'][0]) {
            const vFile = req.files['newsVideoFile'][0];
            const vb64 = Buffer.from(vFile.buffer).toString('base64');
            videoFileData = `data:${vFile.mimetype};base64,${vb64}`;
        }

        const timeVal = createdAt ? Number(createdAt) : Date.now();

        const newNews = {
            id: Date.now(),
            title,
            content,
            category: cat,
            sekil: sekilData,
            videoFile: videoFileData,
            videoUrl: videoUrl || "",
            date: date || new Date().toLocaleString('az-AZ'),
            timestamp: timeVal,
            createdAt: timeVal,
            likes: 0,
            views: 0,
            comments: []
        };

        const { data, error } = await supabase
            .from('news')
            .insert([newNews])
            .select();

        if (error) throw error;

        res.json({ success: true, message: "Xəbər uğurla paylaşıldı!", data });
    } catch (err) {
        console.error("Xəbər əlavəetmə xətası:", err);
        res.status(500).json({ success: false, message: "Xəbər saxlanılan zaman xəta oldu" });
    }
});

app.delete('/api/news/:id', adminLimiter, async (req, res) => {
    const password = req.body?.password || req.headers['x-password'];
    const newsId = req.params.id;
    const currentEnvPassword = process.env.ADMIN_PASSWORD;

    if (!currentEnvPassword || password !== currentEnvPassword) {
        return res.status(403).json({ success: false, message: "Admin şifrəsi yanlışdır!" });
    }

    try {
        const { error: deleteError } = await supabase
            .from('news')
            .delete()
            .eq('id', newsId);

        if (deleteError) throw deleteError;

        res.json({ success: true, message: "Xəbər silindi!" });
    } catch (err) {
        console.error("Silinmə xətası:", err);
        res.status(500).json({ success: false, message: "Silinmə zamanı xəta oldu" });
    }
});

app.post('/api/news/:id/like', async (req, res) => {
    try {
        const newsId = req.params.id;

        const { data: item, error: fetchError } = await supabase
            .from('news')
            .select('likes')
            .eq('id', newsId)
            .single();

        if (fetchError || !item) {
            return res.status(404).json({ success: false, message: "Xəbər tapılmadı" });
        }

        const newLikes = (item.likes || 0) + 1;

        const { error: updateError } = await supabase
            .from('news')
            .update({ likes: newLikes })
            .eq('id', newsId);

        if (updateError) throw updateError;

        res.json({ success: true, likes: newLikes });
    } catch (err) {
        console.error("Like xətası:", err);
        res.status(500).json({ success: false, message: "Xəta baş verdi" });
    }
});

app.post('/api/news/:id/view', async (req, res) => {
    try {
        const newsId = req.params.id;

        const { data: item, error: fetchError } = await supabase
            .from('news')
            .select('views')
            .eq('id', newsId)
            .single();

        if (fetchError || !item) {
            return res.status(404).json({ success: false, message: "Xəbər tapılmadı" });
        }

        const newViews = (item.views || 0) + 1;

        const { error: updateError } = await supabase
            .from('news')
            .update({ views: newViews })
            .eq('id', newsId);

        if (updateError) throw updateError;

        res.json({ success: true, views: newViews });
    } catch (err) {
        console.error("Baxış sayı xətası:", err);
        res.status(500).json({ success: false, message: "Xəta baş verdi" });
    }
});

app.post('/api/site/daily-visit', async (req, res) => {
    try {
        const { date } = req.body; 
        if (!date) return res.status(400).json({ success: false });

        const { data: existing } = await supabase
            .from('news')
            .select('id, views')
            .eq('category', 'SYSTEM_VISITS')
            .eq('title', date)
            .maybeSingle();

        if (existing) {
            await supabase
                .from('news')
                .update({ views: (existing.views || 0) + 1 })
                .eq('id', existing.id);
        } else {
            await supabase
                .from('news')
                .insert([{
                    id: Date.now(),
                    title: date,
                    content: 'Daily Visit Record',
                    category: 'SYSTEM_VISITS',
                    views: 1,
                    createdAt: Date.now()
                }]);
        }

        res.json({ success: true });
    } catch (err) {
        console.error("Günlük ziyarət xətası:", err);
        res.status(500).json({ success: false });
    }
});

app.get('/api/site/daily-stats', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('news')
            .select('title, views')
            .eq('category', 'SYSTEM_VISITS')
            .order('createdAt', { ascending: false })
            .limit(7);

        if (error) throw error;

        const stats = (data || []).map(item => ({
            date: item.title,
            visits: item.views || 0
        }));

        res.json({ success: true, stats });
    } catch (err) {
        console.error("Günlük statistika oxuma xətası:", err);
        res.status(500).json({ success: false, stats: [] });
    }
});

app.post('/api/news/:id/comment', async (req, res) => {
    try {
        const newsId = req.params.id;
        const { comment, username } = req.body;

        if (!comment || comment.trim() === "") {
            return res.status(400).json({ success: false, message: "Şərh boş ola bilməz!" });
        }

        if (comment.length > 500) {
            return res.status(400).json({ success: false, message: "Şərh 500 simvoldan uzun ola bilməz!" });
        }

        const { data: item, error: fetchError } = await supabase
            .from('news')
            .select('comments')
            .eq('id', newsId)
            .single();

        if (fetchError || !item) {
            return res.status(404).json({ success: false, message: "Xəbər tapılmadı" });
        }

        const comments = item.comments || [];
        const newComment = {
            id: Date.now().toString(),
            text: comment.trim(),
            user: username && username.trim() !== "" ? username.trim() : "Oxucu"
        };
        comments.push(newComment);

        const { error: updateError } = await supabase
            .from('news')
            .update({ comments: comments })
            .eq('id', newsId);

        if (updateError) throw updateError;

        res.json({ success: true, comments: comments });
    } catch (err) {
        console.error("Şərh əlavəetmə xətası:", err);
        res.status(500).json({ success: false, message: "Xəta baş verdi" });
    }
});

app.delete('/api/news/:newsId/comment/:commentId', adminLimiter, async (req, res) => {
    try {
        const password = req.body?.password || req.headers['x-password'];
        const newsId = req.params.newsId;
        const commentId = req.params.commentId;
        const currentEnvPassword = process.env.ADMIN_PASSWORD;

        if (!currentEnvPassword || password !== currentEnvPassword) {
            return res.status(403).json({ success: false, message: "Admin şifrəsi yanlışdır!" });
        }

        const { data: item, error: fetchError } = await supabase
            .from('news')
            .select('comments')
            .eq('id', newsId)
            .single();

        if (fetchError || !item) {
            return res.status(404).json({ success: false, message: "Xəbər və ya şərh tapılmadı" });
        }

        let comments = item.comments || [];
        comments = comments.filter(c => String(c.id) !== commentId);

        const { error: updateError } = await supabase
            .from('news')
            .update({ comments: comments })
            .eq('id', newsId);

        if (updateError) throw updateError;

        res.json({ success: true, comments: comments });
    } catch (err) {
        console.error("Şərh silmə xətası:", err);
        res.status(500).json({ success: false, message: "Silinmə zamanı xəta oldu" });
    }
});

app.listen(PORT, () => {
    console.log(`Server Supabase ilə aktivdir: http://localhost:${PORT}`);
});

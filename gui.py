import json
import os
import re
import shutil
import tkinter as tk
from tkinter import ttk, filedialog, messagebox, simpledialog
from PIL import Image, ImageTk

# =====================
# CONFIG
# =====================
PROJECTS_JSON = "data/projects.json"
IMAGES_DIR = "images"
THUMBNAILS_DIR = os.path.join(IMAGES_DIR, "thumbnails")
GALLERY_DIR = os.path.join(IMAGES_DIR, "gallery")

THUMBNAIL_SIZE = (220, 220)
GALLERY_SIZE = (120, 120)

FIELD_MAP = {
    "title": "Title",
    "client": "Client",
    "role": "Role",
    "year": "Year",
    "vimeoId": "Vimeo ID",
    "youtubeId": "Youtube ID",
    "description": "Description",
    "production": "Production",
}

# =====================
# HELPERS
# =====================
def load_data():
    with open(PROJECTS_JSON, "r", encoding="utf-8") as f:
        return json.load(f)

def save_data(data):
    with open(PROJECTS_JSON, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)

# =====================
# SCROLLABLE FRAME
# =====================
class ScrollableFrame(ttk.Frame):
    def __init__(self, container):
        super().__init__(container)
        self.canvas = tk.Canvas(self, highlightthickness=0)
        scrollbar = ttk.Scrollbar(self, orient="vertical", command=self.canvas.yview)
        self.scrollable_frame = ttk.Frame(self.canvas)

        self.scrollable_frame.bind(
            "<Configure>",
            lambda e: self.canvas.configure(scrollregion=self.canvas.bbox("all"))
        )

        self.window_id = self.canvas.create_window((0, 0), window=self.scrollable_frame, anchor="nw")
        self.canvas.configure(yscrollcommand=scrollbar.set)

        self.canvas.pack(side="left", fill="both", expand=True)
        scrollbar.pack(side="right", fill="y")

        self.canvas.bind("<Configure>", self._resize)

    def _resize(self, event):
        self.canvas.itemconfig(self.window_id, width=event.width)

# =====================
# APP
# =====================
class PortfolioApp(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("Portfolio CMS")
        self.geometry("1400x800")

        self.data = load_data()
        self.projects = self.data["projects"]
        self.categories = [c["id"] for c in self.data["categories"]]

        self.selected_index = None
        self.selected_gallery_index = None

        self.thumbnail_image = None
        self.gallery_images = []

        self.btn_style = {
            "font": ("Helvetica", 11),
            "bd": 0,
            "padx": 10,
            "pady": 6,
        }

        self.build_ui()
        self.populate_tree()
        self.bind_shortcuts()

        if self.projects:
            self.selected_index = 0
            cat = self.tree.get_children()[0]
            proj = self.tree.get_children(cat)[0]
            self.tree.selection_set(proj)
            self.load_project()

    # ---------- SHORTCUTS ----------
    def bind_shortcuts(self):
        self.bind_all("<Command-n>", lambda e: self.create_new_project())
        self.bind_all("<Command-d>", lambda e: self.duplicate_project())
        self.bind_all("<Command-Up>", lambda e: self.move_project(-1))
        self.bind_all("<Command-Down>", lambda e: self.move_project(1))

    # ---------- UI ----------
    def build_ui(self):
        container = tk.Frame(self)
        container.pack(fill="both", expand=True)

        # LEFT
        left = tk.Frame(container, width=320)
        left.pack(side="left", fill="y")
        left.pack_propagate(False)

        self.tree = ttk.Treeview(left, show="tree")
        self.tree.pack(fill="both", expand=True, padx=10, pady=10)
        self.tree.bind("<<TreeviewSelect>>", self.on_select)

        btns = tk.Frame(left)
        btns.pack(fill="x", padx=10, pady=6)
        tk.Button(btns, text="➕ New Project", command=self.create_new_project).pack(fill="x", pady=2)
        tk.Button(btns, text="🗑 Delete Project", command=self.delete_project).pack(fill="x", pady=2)
        tk.Button(btns, text="💾 Save All Changes", command=self.save_all).pack(fill="x", pady=2)

        # RIGHT
        right_outer = tk.Frame(container)
        right_outer.pack(side="right", fill="both", expand=True, padx=10, pady=10)

        scroll = ScrollableFrame(right_outer)
        scroll.pack(fill="both", expand=True)
        right = scroll.scrollable_frame

        self.fields = {}
        for key, label in FIELD_MAP.items():
            tk.Label(right, text=label).pack(anchor="w")
            e = tk.Entry(right)
            e.pack(fill="x", pady=2)
            self.fields[key] = e

        tk.Label(right, text="Category").pack(anchor="w", pady=(6, 0))
        self.category_var = tk.StringVar()
        ttk.Combobox(right, values=self.categories, textvariable=self.category_var, state="readonly").pack(fill="x")

        # Thumbnail
        tk.Label(right, text="Thumbnail").pack(anchor="w", pady=(12, 0))
        self.thumbnail_label = tk.Label(right)
        self.thumbnail_label.pack()
        tk.Button(right, text="Change Thumbnail", command=self.pick_thumbnail).pack(fill="x", pady=4)

        # Gallery
        tk.Label(right, text="Gallery").pack(anchor="w", pady=(12, 0))
        self.gallery_canvas = tk.Canvas(right, height=150)
        self.gallery_frame = tk.Frame(self.gallery_canvas)
        self.gallery_window = self.gallery_canvas.create_window((0, 0), window=self.gallery_frame, anchor="nw")
        self.gallery_canvas.pack(fill="x")
        self.gallery_frame.bind(
            "<Configure>",
            lambda e: self.gallery_canvas.configure(scrollregion=self.gallery_canvas.bbox("all"))
        )

        # Gallery controls container
        self.gallery_controls_container = tk.Frame(right)
        self.gallery_controls_container.pack(fill="x", pady=(6, 2))

        self.arrow_prev = tk.Button(self.gallery_controls_container, text="◀", width=3, command=lambda: self.move_gallery(-1), **self.btn_style)
        self.arrow_next = tk.Button(self.gallery_controls_container, text="▶", width=3, command=lambda: self.move_gallery(1), **self.btn_style)
        self.delete_img_btn = tk.Button(
            self.gallery_controls_container,
            text="🗑",
            fg="white",
            bg="#c0392b",
            activebackground="#e74c3c",
            width=3,
            command=self.remove_selected_gallery,
            **self.btn_style
        )
        self.selected_label = tk.Label(self.gallery_controls_container, text="Selected Image", fg="#666")

        self.arrow_prev.pack(side="left")
        self.selected_label.pack(side="left", expand=True)
        self.arrow_next.pack(side="left")
        self.delete_img_btn.pack(side="left", padx=(6,0))

        tk.Frame(self.gallery_controls_container, height=1, bg="#ddd").pack(fill="x", pady=6)

        # Add / replace button (always visible)
        self.gallery_add_btn = tk.Button(
            self.gallery_controls_container,
            text="+ Add / Replace Gallery Images",
            command=self.pick_gallery,
            bg="#f4f4f4",
            **self.btn_style
        )
        self.gallery_add_btn.pack(fill="x")

        tk.Button(right_outer, text="💾 Save Project Changes", command=self.save_project).pack(fill="x", pady=10)

    # ---------- GALLERY ----------
    def load_gallery(self, project):
        for w in self.gallery_frame.winfo_children():
            w.destroy()
        self.gallery_images.clear()
        self.selected_gallery_index = None

        gallery = project.get("gallery", [])
        for i, rel in enumerate(gallery):
            try:
                img = Image.open(os.path.join(GALLERY_DIR, rel))
                img.thumbnail(GALLERY_SIZE)
                tk_img = ImageTk.PhotoImage(img)
                self.gallery_images.append(tk_img)

                lbl = tk.Label(self.gallery_frame, image=tk_img, cursor="hand2")
                lbl.pack(side="left", padx=4)
                lbl.bind("<Button-1>", lambda e, idx=i: self.select_gallery(idx))
            except Exception:
                pass

        self.gallery_canvas.update_idletasks()
        self.gallery_canvas.configure(scrollregion=self.gallery_canvas.bbox("all"))

        # Show/hide arrows and delete button
        if gallery:
            self.arrow_prev.pack(side="left")
            self.arrow_next.pack(side="left")
            self.delete_img_btn.pack(side="left", padx=(6,0))
            self.selected_label.pack(side="left", expand=True)
        else:
            self.arrow_prev.pack_forget()
            self.arrow_next.pack_forget()
            self.delete_img_btn.pack_forget()
            self.selected_label.pack_forget()

    def select_gallery(self, index):
        self.selected_gallery_index = index
        for i, w in enumerate(self.gallery_frame.winfo_children()):
            w.config(
                relief="solid" if i == index else "flat",
                bd=2 if i == index else 0,
                highlightbackground="#4a90e2"
            )

    def move_gallery(self, direction):
        if self.selected_gallery_index is None:
            return
        g = self.projects[self.selected_index]["gallery"]
        i = self.selected_gallery_index
        j = i + direction
        if 0 <= j < len(g):
            g[i], g[j] = g[j], g[i]
            self.load_gallery(self.projects[self.selected_index])
            self.select_gallery(j)

    def remove_selected_gallery(self):
        if self.selected_gallery_index is None:
            return
        self.projects[self.selected_index]["gallery"].pop(self.selected_gallery_index)
        self.load_gallery(self.projects[self.selected_index])

    # ---------- PROJECT OPERATIONS ----------
    def move_project(self, direction):
        if self.selected_index is None:
            return
        i = self.selected_index
        j = i + direction
        if 0 <= j < len(self.projects):
            self.projects[i], self.projects[j] = self.projects[j], self.projects[i]
            self.populate_tree()
            # Reselect project
            self.selected_index = j
            cat = self.projects[j]["category"]
            for child in self.tree.get_children(self.cat_nodes[cat]):
                if int(self.tree.item(child, "values")[0]) == j:
                    self.tree.selection_set(child)
                    self.tree.see(child)
                    break

    def duplicate_project(self):
        if self.selected_index is None:
            return
        orig = self.projects[self.selected_index]
        new_proj = dict(orig)
        new_proj["id"] += "-copy"
        new_proj["title"] += " Copy"
        self.projects.insert(self.selected_index + 1, new_proj)
        self.populate_tree()
        # Select new project
        self.selected_index += 1
        cat = new_proj["category"]
        for child in self.tree.get_children(self.cat_nodes[cat]):
            if int(self.tree.item(child, "values")[0]) == self.selected_index:
                self.tree.selection_set(child)
                self.tree.see(child)
                break

    # ---------- CORE ----------
    def populate_tree(self):
        self.tree.delete(*self.tree.get_children())
        self.cat_nodes = {}
        for c in self.categories:
            self.cat_nodes[c] = self.tree.insert("", "end", text=c, open=True)
        for i, p in enumerate(self.projects):
            self.tree.insert(self.cat_nodes[p["category"]], "end", text=p["title"], values=(i,))

    def on_select(self, _):
        item = self.tree.selection()[0]
        self.selected_index = int(self.tree.item(item, "values")[0])
        self.load_project()

    def load_project(self):
        p = self.projects[self.selected_index]
        for k, e in self.fields.items():
            e.delete(0, tk.END)
            e.insert(0, p.get(k, ""))
        self.category_var.set(p.get("category", ""))
        self.load_thumbnail(p)
        self.load_gallery(p)

    def load_thumbnail(self, project):
        if "thumbnail" in project:
            try:
                img = Image.open(os.path.join(THUMBNAILS_DIR, project["thumbnail"]))
                img.thumbnail(THUMBNAIL_SIZE)
                self.thumbnail_image = ImageTk.PhotoImage(img)
                self.thumbnail_label.config(image=self.thumbnail_image)
            except:
                self.thumbnail_label.config(image="")
        else:
            self.thumbnail_label.config(image="")

    # ---------- ACTIONS ----------
    def pick_thumbnail(self):
        file = filedialog.askopenfilename(
            title="Select Thumbnail",
            filetypes=[("Image Files", "*.png *.jpg *.jpeg *.gif *.bmp")]
        )
        if not file:
            return

        p = self.projects[self.selected_index]
        category_folder = os.path.join(THUMBNAILS_DIR, p["category"])
        os.makedirs(category_folder, exist_ok=True)

        ext = os.path.splitext(file)[1]
        dest_name = f"{p['id']}{ext}"
        dest = os.path.join(category_folder, dest_name)

        shutil.copy(file, dest)
        p["thumbnail"] = os.path.join(p["category"], dest_name)
        self.load_thumbnail(p)

    def pick_gallery(self):
        files = filedialog.askopenfilenames(
            title="Select Gallery Images",
            filetypes=[("Image Files", "*.png *.jpg *.jpeg *.gif *.bmp")]
        )
        if not files:
            return

        p = self.projects[self.selected_index]
        if "gallery" not in p:
            p["gallery"] = []

        project_folder = os.path.join(GALLERY_DIR, p["id"])
        os.makedirs(project_folder, exist_ok=True)

        existing = len(p["gallery"])
        for i, f in enumerate(files, start=1):
            ext = os.path.splitext(f)[1]
            dest_name = f"{p['id']}-{existing+i}{ext}"
            dest = os.path.join(project_folder, dest_name)
            shutil.copy(f, dest)
            p["gallery"].append(os.path.join(p["id"], dest_name))

        self.load_gallery(p)

    def save_project(self):
        p = self.projects[self.selected_index]
        for k, e in self.fields.items():
            v = e.get().strip()
            if v:
                p[k] = v
        p["category"] = self.category_var.get()
        self.populate_tree()

    def save_all(self):
        save_data(self.data)
        messagebox.showinfo("Saved", "All changes saved")

    def create_new_project(self):
        # Popup window
        popup = tk.Toplevel(self)
        popup.title("New Project")
        popup.geometry("300x180")
        popup.transient(self)
        popup.grab_set()

        tk.Label(popup, text="Project Title:").pack(anchor="w", padx=10, pady=(10,0))
        title_entry = tk.Entry(popup)
        title_entry.pack(fill="x", padx=10)

        tk.Label(popup, text="Category:").pack(anchor="w", padx=10, pady=(6,0))
        category_var = tk.StringVar(value="commercial")
        ttk.Combobox(popup, values=self.categories, textvariable=category_var, state="readonly").pack(fill="x", padx=10)

        def create():
            title = title_entry.get().strip()
            category = category_var.get()
            if not title:
                messagebox.showwarning("Error", "Project title cannot be empty")
                return
            base = re.sub(r'[^a-z0-9\-]', '', title.lower().replace(" ", "-"))
            self.projects.append({"id": base, "title": title, "category": category, "gallery": []})
            self.populate_tree()
            popup.destroy()

        tk.Button(popup, text="Create", command=create).pack(pady=10, fill="x", padx=10)
        title_entry.focus()

    def delete_project(self):
        if self.selected_index is None:
            return

        p = self.projects[self.selected_index]

        # Delete thumbnail
        if "thumbnail" in p:
            thumb_path = os.path.join(THUMBNAILS_DIR, p["thumbnail"])
            if os.path.exists(thumb_path):
                try:
                    os.remove(thumb_path)
                except Exception as e:
                    print(f"Error deleting thumbnail: {e}")

        # Delete gallery images
        if "gallery" in p:
            for img_rel in p["gallery"]:
                img_path = os.path.join(GALLERY_DIR, img_rel)
                if os.path.exists(img_path):
                    try:
                        os.remove(img_path)
                    except Exception as e:
                        print(f"Error deleting gallery image: {e}")

            # Remove project folder if empty
            project_folder = os.path.join(GALLERY_DIR, p["id"])
            if os.path.exists(project_folder) and not os.listdir(project_folder):
                try:
                    os.rmdir(project_folder)
                except Exception as e:
                    print(f"Error deleting project folder: {e}")

        # Remove project from list and refresh tree
        self.projects.pop(self.selected_index)
        self.selected_index = None
        self.populate_tree()


# =====================
# RUN
# =====================
if __name__ == "__main__":
    PortfolioApp().mainloop()
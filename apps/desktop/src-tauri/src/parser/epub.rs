use std::fs::File;
use std::io::{Read, Write};
use std::path::Path;
use zip::{ZipArchive, ZipWriter};
use zip::write::SimpleFileOptions;
use quick_xml::events::Event;
use quick_xml::reader::Reader;


pub struct EpubMetadata {
    pub title: Option<String>,
    pub creator: Option<String>,
    pub language: Option<String>,
    pub publisher: Option<String>,
    pub description: Option<String>,
    pub cover_image: Option<Vec<u8>>,
    pub cover_mime: Option<String>,
    pub series: Option<String>,
    pub series_index: Option<f64>,
}

pub fn parse_epub(path: &Path) -> Result<EpubMetadata, String> {
    let file = File::open(path).map_err(|e| e.to_string())?;
    let mut archive = ZipArchive::new(file).map_err(|e| e.to_string())?;

    // 1. Find META-INF/container.xml to locate the .OPF
    let opf_path = find_opf_path(&mut archive)?;
    
    // 2. Parse OPF to get metadata and find cover href
    let (metadata, cover_href) = parse_opf(&mut archive, &opf_path)?;
    
    // 3. Extract cover image if found
    let mut cover_image = None;
    let mut cover_mime = None;

    if let Some(href) = cover_href {
        // Resolve relative path logic if needed, but usually href is relative to OPF folder
        let opf_dir = Path::new(&opf_path).parent().unwrap_or(Path::new(""));
        let image_path = opf_dir.join(href);
        let image_path_str = image_path.to_string_lossy().replace("\\", "/"); // zip uses forward slashes

        if let Ok(mut icon_file) = archive.by_name(&image_path_str) {
             let mut buffer = Vec::new();
             if icon_file.read_to_end(&mut buffer).is_ok() {
                 cover_image = Some(buffer);
                 cover_mime = Some("image/jpeg".to_string()); // minimal mimetype detection or pass from manifest?
             }
        } else {
             // Try absolute or other variants if initial fail (some epubs are messy)
        }
    }

    Ok(EpubMetadata {
        title: metadata.title,
        creator: metadata.creator,
        language: metadata.language,
        publisher: metadata.publisher,
        description: metadata.description,
        cover_image,
        cover_mime,
        series: metadata.series,
        series_index: metadata.series_index,
    })
}

fn find_opf_path(archive: &mut ZipArchive<File>) -> Result<String, String> {
    let mut container = archive.by_name("META-INF/container.xml")
        .map_err(|_| "Missing META-INF/container.xml".to_string())?;
    
    let mut xml = String::new();
    container.read_to_string(&mut xml).map_err(|e| e.to_string())?;

    let mut reader = Reader::from_str(&xml);
    let mut buf = Vec::new();
    
    // Simple looking for <rootfile ... full-path="POB/content.opf" ... />
    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Empty(e)) | Ok(Event::Start(e)) => {
                if e.name().as_ref() == b"rootfile" {
                   for attr in e.attributes() {
                       let attr = attr.map_err(|e| e.to_string())?;
                       if attr.key.as_ref() == b"full-path" {
                           return Ok(String::from_utf8_lossy(&attr.value).to_string());
                       }
                   }
                }
            }
            Ok(Event::Eof) => break,
            Err(e) => return Err(e.to_string()),
            _ => (),
        }
        buf.clear();
    }

    Err("Could not find OPF path in container.xml".to_string())
}

struct PartialMeta {
    title: Option<String>,
    creator: Option<String>,
    language: Option<String>,
    description: Option<String>,
    publisher: Option<String>,
    series: Option<String>,
    series_index: Option<f64>,
}

fn parse_opf(archive: &mut ZipArchive<File>, opf_path: &str) -> Result<(PartialMeta, Option<String>), String> {
    let mut opf_file = archive.by_name(opf_path).map_err(|e| e.to_string())?;
    let mut xml = String::new();
    opf_file.read_to_string(&mut xml).map_err(|e| e.to_string())?;
    
    let mut reader = Reader::from_str(&xml);
    let mut buf = Vec::new();
    
    let mut meta = PartialMeta {
        title: None, creator: None, language: None, description: None, publisher: None,
        series: None, series_index: None,
    };
    let mut cover_id = None;
    let mut cover_href = None;
    
    // State machine for generic parsing
    let mut in_title = false;
    let mut in_creator = false;
    let mut in_lang = false;
    let mut in_desc = false;
    let mut in_pub = false;
    
    // 1. First pass: Metadata
    loop {
         match reader.read_event_into(&mut buf) {
             Ok(Event::Start(e)) => {
                 match e.name().as_ref() {
                     b"dc:title" => in_title = true,
                     b"dc:creator" => in_creator = true,
                     b"dc:language" => in_lang = true,
                     b"dc:description" => in_desc = true,
                     b"dc:publisher" => in_pub = true,
                     b"meta" => {
                         // Check for <meta name="cover" content="cover-image-id" />
                         // Also check for calibre:series and calibre:series_index
                         let mut name = String::new();
                         let mut content = String::new();
                         for attr in e.attributes() {
                             if let Ok(a) = attr {
                                 if a.key.as_ref() == b"name" { name = String::from_utf8_lossy(&a.value).to_string(); }
                                 if a.key.as_ref() == b"content" { content = String::from_utf8_lossy(&a.value).to_string(); }
                             }
                         }
                         if name == "cover" {
                             cover_id = Some(content);
                         } else if name == "calibre:series" {
                             meta.series = Some(content);
                         } else if name == "calibre:series_index" {
                             meta.series_index = content.parse::<f64>().ok();
                         }
                     }
                     _ => (),
                 }
             }
             Ok(Event::Empty(e)) => {
                 if e.name().as_ref() == b"meta" {
                      // Same check for self-closing meta tags
                      // Also check for calibre:series and calibre:series_index
                      let mut name = String::new();
                      let mut content = String::new();
                      for attr in e.attributes() {
                          if let Ok(a) = attr {
                              if a.key.as_ref() == b"name" { name = String::from_utf8_lossy(&a.value).to_string(); }
                              if a.key.as_ref() == b"content" { content = String::from_utf8_lossy(&a.value).to_string(); }
                          }
                      }
                      if name == "cover" {
                          cover_id = Some(content);
                      } else if name == "calibre:series" {
                          meta.series = Some(content);
                      } else if name == "calibre:series_index" {
                          meta.series_index = content.parse::<f64>().ok();
                      }
                 } else if e.name().as_ref() == b"item" {
                     // Look for item properties="cover-image"
                     // Also, if we have a cover_id, we look for its href here
                     let mut id = String::new();
                     let mut href = String::new();
                     let mut props = String::new();
                     
                      for attr in e.attributes() {
                          if let Ok(a) = attr {
                              if a.key.as_ref() == b"id" { id = String::from_utf8_lossy(&a.value).to_string(); }
                              if a.key.as_ref() == b"href" { href = String::from_utf8_lossy(&a.value).to_string(); }
                              if a.key.as_ref() == b"properties" { props = String::from_utf8_lossy(&a.value).to_string(); }
                          }
                      }
                      
                      if let Some(cid) = &cover_id {
                          if &id == cid {
                              cover_href = Some(href.clone());
                          }
                      }
                      if props.contains("cover-image") {
                           cover_href = Some(href);
                      }
                 }
             }
             Ok(Event::Text(e)) => {
                 let text = e.unescape().unwrap_or_default().into_owned();
                 if in_title { meta.title = Some(text); }
                 else if in_creator { meta.creator = Some(text); }
                 else if in_lang { meta.language = Some(text); }
                 else if in_desc { meta.description = Some(text); }
                 else if in_pub { meta.publisher = Some(text); }
             }
             Ok(Event::End(e)) => {
                 match e.name().as_ref() {
                     b"dc:title" => in_title = false,
                     b"dc:creator" => in_creator = false,
                     b"dc:language" => in_lang = false,
                     b"dc:description" => in_desc = false,
                     b"dc:publisher" => in_pub = false,
                     _ => (),
                 }
             }
             Ok(Event::Eof) => break,
             _ => (),
         }
         buf.clear();
    }
    
    Ok((meta, cover_href))
}

/// Write a cover image into an EPUB file
/// This modifies the EPUB in place by:
/// 1. Adding the cover image file
/// 2. Updating the OPF manifest to include the cover
/// 3. Adding metadata reference to the cover
pub fn write_epub_cover(epub_path: &Path, cover_bytes: &[u8], cover_extension: &str) -> Result<(), String> {
    // Read the entire EPUB into memory
    let file = File::open(epub_path).map_err(|e| format!("Failed to open EPUB: {}", e))?;
    let mut archive = ZipArchive::new(file).map_err(|e| format!("Failed to read EPUB archive: {}", e))?;

    // Find the OPF path
    let opf_path = find_opf_path(&mut archive)?;
    let opf_dir = Path::new(&opf_path).parent().map(|p| p.to_string_lossy().to_string()).unwrap_or_default();

    // Determine cover filename and path within EPUB
    let cover_filename = format!("cover.{}", cover_extension);
    let cover_path_in_epub = if opf_dir.is_empty() {
        cover_filename.clone()
    } else {
        format!("{}/{}", opf_dir, cover_filename)
    };

    // Read the OPF file
    let mut opf_file = archive.by_name(&opf_path).map_err(|e| format!("Failed to read OPF: {}", e))?;
    let mut opf_content = String::new();
    opf_file.read_to_string(&mut opf_content).map_err(|e| format!("Failed to read OPF content: {}", e))?;
    drop(opf_file);

    // Check if cover already exists in manifest
    let has_cover_item = opf_content.contains("id=\"cover-image\"") || opf_content.contains("properties=\"cover-image\"");

    // Modify OPF to add cover reference if not present
    let modified_opf = if !has_cover_item {
        add_cover_to_opf(&opf_content, &cover_filename, cover_extension)?
    } else {
        opf_content.clone()
    };

    // Collect all file names and contents from the archive
    let mut files: Vec<(String, Vec<u8>)> = Vec::new();

    // Re-open archive to read all files
    let file = File::open(epub_path).map_err(|e| format!("Failed to reopen EPUB: {}", e))?;
    let mut archive = ZipArchive::new(file).map_err(|e| format!("Failed to read EPUB archive: {}", e))?;

    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| format!("Failed to read entry: {}", e))?;
        let name = entry.name().to_string();

        // Skip the cover file if it exists (we'll replace it)
        if name == cover_path_in_epub {
            continue;
        }

        let mut content = Vec::new();
        entry.read_to_end(&mut content).map_err(|e| format!("Failed to read entry content: {}", e))?;

        // Replace OPF content with modified version
        if name == opf_path {
            files.push((name, modified_opf.as_bytes().to_vec()));
        } else {
            files.push((name, content));
        }
    }

    // Add the cover image
    files.push((cover_path_in_epub, cover_bytes.to_vec()));

    // Write the new EPUB
    let output_file = File::create(epub_path).map_err(|e| format!("Failed to create output EPUB: {}", e))?;
    let mut zip_writer = ZipWriter::new(output_file);
    let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);

    for (name, content) in files {
        zip_writer.start_file(&name, options).map_err(|e| format!("Failed to write file {}: {}", name, e))?;
        zip_writer.write_all(&content).map_err(|e| format!("Failed to write content for {}: {}", name, e))?;
    }

    zip_writer.finish().map_err(|e| format!("Failed to finalize EPUB: {}", e))?;

    Ok(())
}

/// Add cover image reference to OPF content
fn add_cover_to_opf(opf_content: &str, cover_filename: &str, cover_extension: &str) -> Result<String, String> {
    let media_type = match cover_extension {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "gif" => "image/gif",
        _ => "image/jpeg",
    };

    // Add item to manifest
    let manifest_item = format!(
        r#"    <item id="cover-image" href="{}" media-type="{}" properties="cover-image"/>"#,
        cover_filename, media_type
    );

    // Add meta to metadata
    let meta_entry = r#"    <meta name="cover" content="cover-image"/>"#;

    let mut result = opf_content.to_string();

    // Insert manifest item before </manifest>
    if let Some(pos) = result.find("</manifest>") {
        result.insert_str(pos, &format!("{}\n  ", manifest_item));
    }

    // Insert meta entry before </metadata>
    if let Some(pos) = result.find("</metadata>") {
        result.insert_str(pos, &format!("{}\n  ", meta_entry));
    }

    Ok(result)
}

/// Write metadata to an EPUB file (title, author, etc.)
pub fn write_epub_metadata(
    epub_path: &Path,
    title: Option<&str>,
    author: Option<&str>,
    language: Option<&str>,
    description: Option<&str>,
    publisher: Option<&str>,
) -> Result<(), String> {
    // Read the entire EPUB into memory
    let file = File::open(epub_path).map_err(|e| format!("Failed to open EPUB: {}", e))?;
    let mut archive = ZipArchive::new(file).map_err(|e| format!("Failed to read EPUB archive: {}", e))?;

    // Find the OPF path
    let opf_path = find_opf_path(&mut archive)?;

    // Read the OPF file
    let mut opf_file = archive.by_name(&opf_path).map_err(|e| format!("Failed to read OPF: {}", e))?;
    let mut opf_content = String::new();
    opf_file.read_to_string(&mut opf_content).map_err(|e| format!("Failed to read OPF content: {}", e))?;
    drop(opf_file);

    // Modify OPF metadata
    let modified_opf = update_opf_metadata(&opf_content, title, author, language, description, publisher)?;

    // Collect all files from the archive
    let mut files: Vec<(String, Vec<u8>)> = Vec::new();

    let file = File::open(epub_path).map_err(|e| format!("Failed to reopen EPUB: {}", e))?;
    let mut archive = ZipArchive::new(file).map_err(|e| format!("Failed to read EPUB archive: {}", e))?;

    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| format!("Failed to read entry: {}", e))?;
        let name = entry.name().to_string();

        let mut content = Vec::new();
        entry.read_to_end(&mut content).map_err(|e| format!("Failed to read entry content: {}", e))?;

        if name == opf_path {
            files.push((name, modified_opf.as_bytes().to_vec()));
        } else {
            files.push((name, content));
        }
    }

    // Write the new EPUB
    let output_file = File::create(epub_path).map_err(|e| format!("Failed to create output EPUB: {}", e))?;
    let mut zip_writer = ZipWriter::new(output_file);
    let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);

    for (name, content) in files {
        zip_writer.start_file(&name, options).map_err(|e| format!("Failed to write file {}: {}", name, e))?;
        zip_writer.write_all(&content).map_err(|e| format!("Failed to write content for {}: {}", name, e))?;
    }

    zip_writer.finish().map_err(|e| format!("Failed to finalize EPUB: {}", e))?;

    Ok(())
}

/// Update metadata fields in OPF content using simple string replacement
fn update_opf_metadata(
    opf_content: &str,
    title: Option<&str>,
    author: Option<&str>,
    language: Option<&str>,
    description: Option<&str>,
    publisher: Option<&str>,
) -> Result<String, String> {
    use regex::Regex;

    let mut result = opf_content.to_string();

    // Update or add title
    if let Some(new_title) = title {
        let title_re = Regex::new(r"<dc:title[^>]*>([^<]*)</dc:title>").map_err(|e| e.to_string())?;
        if title_re.is_match(&result) {
            result = title_re.replace(&result, format!("<dc:title>{}</dc:title>", escape_xml(new_title))).to_string();
        } else if let Some(pos) = result.find("</metadata>") {
            result.insert_str(pos, &format!("  <dc:title>{}</dc:title>\n  ", escape_xml(new_title)));
        }
    }

    // Update or add creator (author)
    if let Some(new_author) = author {
        let creator_re = Regex::new(r"<dc:creator[^>]*>([^<]*)</dc:creator>").map_err(|e| e.to_string())?;
        if creator_re.is_match(&result) {
            result = creator_re.replace(&result, format!("<dc:creator>{}</dc:creator>", escape_xml(new_author))).to_string();
        } else if let Some(pos) = result.find("</metadata>") {
            result.insert_str(pos, &format!("  <dc:creator>{}</dc:creator>\n  ", escape_xml(new_author)));
        }
    }

    // Update or add language
    if let Some(new_lang) = language {
        let lang_re = Regex::new(r"<dc:language[^>]*>([^<]*)</dc:language>").map_err(|e| e.to_string())?;
        if lang_re.is_match(&result) {
            result = lang_re.replace(&result, format!("<dc:language>{}</dc:language>", escape_xml(new_lang))).to_string();
        } else if let Some(pos) = result.find("</metadata>") {
            result.insert_str(pos, &format!("  <dc:language>{}</dc:language>\n  ", escape_xml(new_lang)));
        }
    }

    // Update or add description
    if let Some(new_desc) = description {
        let desc_re = Regex::new(r"<dc:description[^>]*>([^<]*)</dc:description>").map_err(|e| e.to_string())?;
        if desc_re.is_match(&result) {
            result = desc_re.replace(&result, format!("<dc:description>{}</dc:description>", escape_xml(new_desc))).to_string();
        } else if let Some(pos) = result.find("</metadata>") {
            result.insert_str(pos, &format!("  <dc:description>{}</dc:description>\n  ", escape_xml(new_desc)));
        }
    }

    // Update or add publisher
    if let Some(new_pub) = publisher {
        let pub_re = Regex::new(r"<dc:publisher[^>]*>([^<]*)</dc:publisher>").map_err(|e| e.to_string())?;
        if pub_re.is_match(&result) {
            result = pub_re.replace(&result, format!("<dc:publisher>{}</dc:publisher>", escape_xml(new_pub))).to_string();
        } else if let Some(pos) = result.find("</metadata>") {
            result.insert_str(pos, &format!("  <dc:publisher>{}</dc:publisher>\n  ", escape_xml(new_pub)));
        }
    }

    Ok(result)
}

/// Escape special XML characters
fn escape_xml(s: &str) -> String {
    s.replace('&', "&amp;")
     .replace('<', "&lt;")
     .replace('>', "&gt;")
     .replace('"', "&quot;")
     .replace('\'', "&apos;")
}

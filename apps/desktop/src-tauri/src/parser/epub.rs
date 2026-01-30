use std::fs::File;
use std::io::{Read, Cursor};
use std::path::Path;
use zip::ZipArchive;
use quick_xml::events::Event;
use quick_xml::reader::Reader;
use crate::models::Book;

pub struct EpubMetadata {
    pub title: Option<String>,
    pub creator: Option<String>,
    pub language: Option<String>,
    pub publisher: Option<String>,
    pub description: Option<String>,
    pub cover_image: Option<Vec<u8>>,
    pub cover_mime: Option<String>,
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
}

fn parse_opf(archive: &mut ZipArchive<File>, opf_path: &str) -> Result<(PartialMeta, Option<String>), String> {
    let mut opf_file = archive.by_name(opf_path).map_err(|e| e.to_string())?;
    let mut xml = String::new();
    opf_file.read_to_string(&mut xml).map_err(|e| e.to_string())?;
    
    let mut reader = Reader::from_str(&xml);
    let mut buf = Vec::new();
    
    let mut meta = PartialMeta { 
        title: None, creator: None, language: None, description: None, publisher: None 
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
                         }
                     }
                     _ => (),
                 }
             }
             Ok(Event::Empty(e)) => {
                 if e.name().as_ref() == b"meta" {
                      // Same check for self-closing meta tags
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

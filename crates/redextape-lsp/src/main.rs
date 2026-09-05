//! The `redextape-lsp` binary: stdio, the initialize handshake, and the loop that hands every
//! message to `Server::handle`.
//!
//! **THIS FILE IS THE ONLY ONE IN THE CRATE THAT NAMES `lsp-server`.** Almost all of what it does is
//! transport: read a framed message off stdin, translate the envelope, hand it to the handler,
//! write what comes back. That is what makes the handler testable without a process and what keeps
//! the door open for a wasm caller that has no stdio at all.
//! `git grep -l lsp_server crates/redextape-lsp/src` must print this path and nothing else.
//!
//! **THE ONE EXCEPTION IS SHUTDOWN, AND SAYING SO IS CHEAPER THAN PRETENDING OTHERWISE.**
//! `Connection::handle_shutdown` below does not report the request and step aside — it answers it,
//! with an empty success response of its own, and then blocks for up to thirty seconds waiting for
//! `exit`, failing if anything else arrives. So the ordering rule the protocol states around those
//! two messages is enforced here, in the transport, and the handler's own `shutdown` arm never runs
//! over stdio. The helper is used anyway rather than reimplemented in the handler: it is the piece
//! that already knows that rule, and a second copy of it would be the drift this crate's layout
//! exists to avoid.

use std::error::Error;

use lsp_server::{Connection, Message, Notification, Request, Response};
use redextape_lsp::{Outgoing, Server};

fn main() -> Result<(), Box<dyn Error + Sync + Send>> {
    let (connection, io_threads) = Connection::stdio();
    let mut server = Server::new();

    // The handshake goes through the ordinary handler rather than through
    // `Connection::initialize`. That helper answers `initialize` itself with capabilities the
    // caller passes in, which would put the capability decision here — in the file with no tests —
    // rather than in the one that has them.
    let (id, params) = connection.initialize_start()?;
    let init = to_request_object(&Request { id: id.clone(), method: "initialize".into(), params });
    for out in server.handle(init) {
        if let Outgoing::Response(response) = out {
            let value = response.result().cloned().ok_or("the initialize handler answered with an error")?;
            connection.initialize_finish(id.clone(), value)?;
        }
    }

    for message in &connection.receiver {
        match message {
            Message::Request(request) => {
                if connection.handle_shutdown(&request)? {
                    break;
                }
                dispatch(&connection, &mut server, to_request_object(&request))?;
            }
            Message::Notification(notification) => {
                let object = notification_to_request_object(&notification);
                dispatch(&connection, &mut server, object)?;
            }
            // A response is an answer to a request this server sent, and it sends none.
            Message::Response(_) => {}
        }
    }

    // The writer thread's channel is a rendezvous with `connection.sender` as its only producer;
    // `join` waits for that thread to see the channel close, which only happens once every sender
    // is gone. `connection` lives in this function's scope for the whole call, so without an
    // explicit drop here the sender outlives the join and the two wait on each other forever —
    // this is the shape of the hang the brief warned about, not the missing-`initialized` one.
    drop(connection);
    io_threads.join()?;
    Ok(())
}

/// An `lsp-server` request as the JSON-RPC envelope the handler speaks.
///
/// Both sides are plain serde types over the same wire shape, so the translation is a round trip
/// through `serde_json::Value` rather than a field-by-field copy that could drift from either.
fn to_request_object(request: &Request) -> gen_lsp_types::json_rpc::RequestObject {
    serde_json::from_value(serde_json::json!({
        "jsonrpc": "2.0",
        "id": request.id,
        "method": request.method,
        "params": request.params,
    }))
    .unwrap_or_else(|_| unreachable!("a Request always forms a valid RequestObject"))
}

/// An `lsp-server` notification as the JSON-RPC envelope the handler speaks. See
/// [`to_request_object`]: same round trip, minus the `id` a notification never carries.
fn notification_to_request_object(n: &Notification) -> gen_lsp_types::json_rpc::RequestObject {
    serde_json::from_value(serde_json::json!({
        "jsonrpc": "2.0",
        "method": n.method,
        "params": n.params,
    }))
    .unwrap_or_else(|_| unreachable!("a Notification always forms a valid RequestObject"))
}

/// Hand one envelope to the handler and write back everything it returns.
fn dispatch(
    connection: &Connection,
    server: &mut Server,
    object: gen_lsp_types::json_rpc::RequestObject,
) -> Result<(), Box<dyn Error + Sync + Send>> {
    for out in server.handle(object) {
        connection.sender.send(to_message(&out)?)?;
    }
    Ok(())
}

/// One handler-side outgoing message as the `lsp-server` message it is written to stdout as.
fn to_message(out: &Outgoing) -> Result<Message, Box<dyn Error + Sync + Send>> {
    Ok(match out {
        Outgoing::Response(r) => Message::Response(serde_json::from_value::<Response>(serde_json::to_value(r)?)?),
        Outgoing::Notification(n) => Message::Notification(Notification {
            method: n.method().to_string(),
            params: n.params().cloned().unwrap_or(serde_json::Value::Null),
        }),
    })
}

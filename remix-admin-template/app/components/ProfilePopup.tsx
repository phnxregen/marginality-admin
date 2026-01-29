import { Form, Link } from "@remix-run/react";
import { useRef, useState } from "react";

import Popup from "./Popup";

export default function ProfilePopup() {
  const [isPopupOpen, setIsPopupOpen] = useState(false);
  const popupButtonRef = useRef<HTMLButtonElement>(null);

  return (
    <div className="relative">
      <button
        className="flex items-center justify-center cursor-pointer"
        onClick={() => setIsPopupOpen(!isPopupOpen)}
        ref={popupButtonRef}
      >
        <img
          className="w-12 h-12 rounded-full ring-2 ring-cyan-300"
          src="/user.jpg"
          alt="avatar"
        />
      </button>
      {isPopupOpen && (
        <Popup
          isOpen={isPopupOpen}
          setIsOpen={setIsPopupOpen}
          buttonRef={popupButtonRef}
          className="right-0 p-4 mt-2 bg-white rounded-md shadow-sm top-full"
        >
          <div className="py-2 space-y-1">
            <Form action="/logout" method="POST">
              <button
                type="submit"
                className="w-full px-4 py-2 text-sm text-left transition rounded-md text-slate-700 hover:text-white hover:bg-cyan-500/90"
              >
                Logout
              </button>
            </Form>
          </div>
        </Popup>
      )}
    </div>
  );
}
